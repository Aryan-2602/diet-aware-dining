import {
  callLLMRaw,
  LLMUnavailableError,
  type ChatMessage,
  type ToolSchema,
} from "@/lib/llm-client";

/**
 * Agent runtime: a bounded tool-calling loop over the Chat Completions API.
 *
 * The division of labour is deliberate. The model decides *strategy* — which
 * radius to try, whether a constraint is worth relaxing, when it has enough to
 * answer. Tools are ordinary deterministic functions, and anything that affects
 * dietary safety lives inside them rather than in the model's judgement. An
 * agent choosing "widen the search" cannot hurt anyone; an agent deciding "this
 * is probably fine for a peanut allergy" could.
 *
 * Every failure throws LLMUnavailableError so callers can fall back to a
 * deterministic path and keep working with no API key.
 */

/** A tool the agent may call. `execute` receives the model's parsed arguments. */
export interface AgentTool<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
  execute: (args: TArgs) => Promise<TResult> | TResult;
}

export interface RunAgentOptions {
  system: string;
  user: string;
  tools: AgentTool<never, unknown>[];
  /** Hard ceiling on model round-trips. Guards against loops and latency. */
  maxIterations?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Constrain the final answer to JSON. Prompt must mention JSON. */
  jsonMode?: boolean;
}

export interface AgentRun {
  /** The agent's final message. */
  content: string;
  /** Every tool invocation, in order — the audit trail for what it did. */
  trace: AgentToolInvocation[];
}

export interface AgentToolInvocation {
  tool: string;
  args: unknown;
  result: unknown;
  error?: string;
}

const DEFAULT_MAX_ITERATIONS = 6;

export async function runAgent({
  system,
  user,
  tools,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  maxTokens,
  timeoutMs,
  jsonMode = false,
}: RunAgentOptions): Promise<AgentRun> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const schemas: ToolSchema[] = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const trace: AgentToolInvocation[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const isFinalIteration = iteration === maxIterations - 1;

    const reply = await callLLMRaw({
      messages,
      // On the last permitted round-trip, withhold the tools so the model is
      // forced to answer from what it already has rather than requesting a
      // call we will not run.
      tools: isFinalIteration ? undefined : schemas,
      maxTokens,
      timeoutMs,
      // json_object mode is incompatible with a turn that emits tool calls,
      // so it is only applied once tools are off the table.
      jsonMode: jsonMode && isFinalIteration,
    });

    if (!reply.toolCalls.length) {
      if (!reply.content) {
        throw new LLMUnavailableError(
          "Agent returned neither content nor a tool call"
        );
      }
      return { content: reply.content, trace };
    }

    messages.push({
      role: "assistant",
      content: reply.content,
      tool_calls: reply.toolCalls,
    });

    for (const call of reply.toolCalls) {
      const tool = byName.get(call.function.name);
      const invocation = await executeToolCall(tool, call.function.arguments);
      trace.push({
        tool: call.function.name,
        args: invocation.args,
        result: invocation.result,
        error: invocation.error,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: invocation.serialized,
      });
    }
  }

  throw new LLMUnavailableError(
    `Agent exceeded ${maxIterations} iterations without producing an answer`
  );
}

/**
 * Runs one tool call. A tool that throws is reported back to the model as an
 * error result rather than aborting the run — the agent can then try a
 * different approach, which is the point of giving it a loop.
 */
async function executeToolCall(
  tool: AgentTool<never, unknown> | undefined,
  rawArgs: string
): Promise<{
  args: unknown;
  result: unknown;
  error?: string;
  serialized: string;
}> {
  let args: unknown = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    const error = `Arguments were not valid JSON: ${rawArgs}`;
    return { args: rawArgs, result: null, error, serialized: `ERROR: ${error}` };
  }

  if (!tool) {
    const error = "No such tool";
    return { args, result: null, error, serialized: `ERROR: ${error}` };
  }

  try {
    const result = await tool.execute(args as never);
    return { args, result, serialized: JSON.stringify(result) ?? "null" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { args, result: null, error, serialized: `ERROR: ${error}` };
  }
}
