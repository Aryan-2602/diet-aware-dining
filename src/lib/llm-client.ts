/**
 * Minimal, dependency-free Anthropic Messages API client.
 *
 * Server-side only — this module reads ANTHROPIC_API_KEY from process.env and
 * is reached exclusively from agents invoked by Next.js API routes. It must
 * never be imported into a client component.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Thrown whenever the LLM cannot produce a usable answer: missing API key,
 * non-2xx response, timeout, network failure, or an unparseable payload.
 * Callers rely on this specific type to decide whether to fall back to a
 * deterministic path.
 */
export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

export interface CallClaudeOptions {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  content?: AnthropicContentBlock[];
}

/**
 * Sends a single-turn request to the Messages API and returns the text of the
 * first `type: "text"` block in the response.
 */
export async function callClaude({
  system,
  user,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CallClaudeOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LLMUnavailableError("ANTHROPIC_API_KEY is not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LLMUnavailableError(
        `Anthropic request timed out after ${timeoutMs}ms`
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new LLMUnavailableError(`Anthropic request failed: ${detail}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LLMUnavailableError(
      `Anthropic API returned ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  let payload: AnthropicMessagesResponse;
  try {
    payload = (await response.json()) as AnthropicMessagesResponse;
  } catch {
    throw new LLMUnavailableError("Anthropic API returned a non-JSON body");
  }

  const textBlock = payload.content?.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new LLMUnavailableError(
      "Anthropic API response contained no text block"
    );
  }

  return textBlock.text;
}

/**
 * Parses a JSON payload that may be wrapped in ```json / ``` fences.
 * Throws whatever JSON.parse throws when the payload is not valid JSON.
 */
export function parseJSONResponse<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?[ \t]*\r?\n?/i, "")
    .replace(/\r?\n?[ \t]*```$/, "")
    .trim();

  return JSON.parse(cleaned) as T;
}
