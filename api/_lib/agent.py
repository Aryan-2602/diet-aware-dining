"""Agent runtime: a bounded tool-calling loop over the Chat Completions API.

The division of labour is deliberate. The model decides *strategy*; tools are
ordinary deterministic functions, and anything that affects dietary safety lives
inside them rather than in the model's judgement. An agent choosing "widen the
search" cannot hurt anyone; an agent deciding "this is probably fine for a peanut
allergy" could.

Every failure raises LLMUnavailableError so callers can fall back to a
deterministic path and keep working with no API key.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional, Union

from .errors import LLMUnavailableError
from .llm_client import call_llm_raw

ToolFn = Callable[[dict[str, Any]], Union[Any, Awaitable[Any]]]


@dataclass
class AgentTool:
    """A tool the agent may call. ``execute`` receives the parsed arguments."""

    name: str
    description: str
    #: JSON Schema for the arguments object.
    parameters: dict[str, Any]
    execute: ToolFn


@dataclass
class AgentToolInvocation:
    tool: str
    args: Any
    result: Any
    error: Optional[str] = None


@dataclass
class AgentRun:
    #: The agent's final message.
    content: str
    #: Every tool invocation, in order -- the audit trail for what it did.
    trace: list[AgentToolInvocation] = field(default_factory=list)


DEFAULT_MAX_ITERATIONS = 6


async def run_agent(
    system: str,
    user: str,
    tools: list[AgentTool],
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    max_tokens: int = 512,
    timeout_s: float = 8.0,
    json_mode: bool = False,
) -> AgentRun:
    by_name = {tool.name: tool for tool in tools}
    schemas = [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
        for tool in tools
    ]

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    trace: list[AgentToolInvocation] = []

    for iteration in range(max_iterations):
        is_final = iteration == max_iterations - 1

        reply = await call_llm_raw(
            messages=messages,
            # On the last permitted round-trip, withhold the tools so the model
            # is forced to answer from what it already has rather than
            # requesting a call we will not run.
            tools=None if is_final else schemas,
            max_tokens=max_tokens,
            timeout_s=timeout_s,
            # json_object mode is incompatible with a turn that emits tool
            # calls, so it is only applied once tools are off the table.
            json_mode=json_mode and is_final,
        )

        if not reply.toolCalls:
            if not reply.content:
                raise LLMUnavailableError(
                    "Agent returned neither content nor a tool call"
                )
            return AgentRun(content=reply.content, trace=trace)

        messages.append(
            {
                "role": "assistant",
                "content": reply.content,
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": call.arguments,
                        },
                    }
                    for call in reply.toolCalls
                ],
            }
        )

        for call in reply.toolCalls:
            invocation, serialized = await _execute_tool_call(
                by_name.get(call.name), call.arguments
            )
            invocation.tool = call.name
            trace.append(invocation)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": serialized,
                }
            )

    raise LLMUnavailableError(
        f"Agent exceeded {max_iterations} iterations without producing an answer"
    )


async def _execute_tool_call(
    tool: Optional[AgentTool], raw_args: str
) -> tuple[AgentToolInvocation, str]:
    """Runs one tool call.

    A tool that raises is reported back to the model as an error result rather
    than aborting the run -- the agent can then try a different approach, which
    is the point of giving it a loop.
    """
    try:
        args = json.loads(raw_args) if raw_args else {}
    except ValueError:
        error = f"Arguments were not valid JSON: {raw_args}"
        return (
            AgentToolInvocation(tool="", args=raw_args, result=None, error=error),
            f"ERROR: {error}",
        )

    if tool is None:
        error = "No such tool"
        return (
            AgentToolInvocation(tool="", args=args, result=None, error=error),
            f"ERROR: {error}",
        )

    try:
        result = tool.execute(args)
        if hasattr(result, "__await__"):
            result = await result  # type: ignore[misc]
        return (
            AgentToolInvocation(tool="", args=args, result=result),
            json.dumps(result, default=str),
        )
    except Exception as error:  # noqa: BLE001 - surfaced to the model, not swallowed
        message = str(error)
        return (
            AgentToolInvocation(tool="", args=args, result=None, error=message),
            f"ERROR: {message}",
        )
