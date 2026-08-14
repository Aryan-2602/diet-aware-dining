/**
 * Minimal, dependency-free OpenAI Chat Completions client.
 *
 * Server-side only — this module reads OPENAI_API_KEY from process.env and
 * is reached exclusively from agents invoked by Next.js API routes. It must
 * never be imported into a client component.
 */

const OPENAI_CHAT_COMPLETIONS_URL =
  "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
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

export interface CallLLMOptions {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Ask the API to guarantee syntactically valid JSON. The prompt must
   * mention JSON for the API to accept this.
   */
  jsonMode?: boolean;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
}

/**
 * Sends a single-turn request to the Chat Completions API and returns the
 * assistant message content.
 */
export async function callLLM({
  system,
  user,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  jsonMode = false,
}: CallLLMOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMUnavailableError("OPENAI_API_KEY is not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        max_completion_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LLMUnavailableError(
        `OpenAI request timed out after ${timeoutMs}ms`
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new LLMUnavailableError(`OpenAI request failed: ${detail}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LLMUnavailableError(
      `OpenAI API returned ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  let payload: OpenAIChatCompletionResponse;
  try {
    payload = (await response.json()) as OpenAIChatCompletionResponse;
  } catch {
    throw new LLMUnavailableError("OpenAI API returned a non-JSON body");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new LLMUnavailableError("OpenAI API response contained no content");
  }

  return content;
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
