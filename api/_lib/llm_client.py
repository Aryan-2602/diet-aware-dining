"""Minimal OpenAI Chat Completions client.

Server-side only -- reads OPENAI_API_KEY from the environment. Deliberately thin:
one HTTP call, no SDK, so the dependency surface stays at httpx and the failure
modes are all visible in this file.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Optional, TypeVar

import httpx

from .errors import LLMUnavailableError

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_MAX_TOKENS = 512
DEFAULT_TIMEOUT_S = 8.0

T = TypeVar("T")


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str


@dataclass
class LLMReply:
    content: Optional[str]
    toolCalls: list[ToolCall] = field(default_factory=list)
    finishReason: Optional[str] = None


async def call_llm(
    system: str,
    user: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    json_mode: bool = False,
) -> str:
    """Single-turn call returning the assistant message text."""
    reply = await call_llm_raw(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        timeout_s=timeout_s,
        json_mode=json_mode,
    )
    if not reply.content:
        raise LLMUnavailableError("OpenAI API response contained no content")
    return reply.content


async def call_llm_raw(
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    json_mode: bool = False,
) -> LLMReply:
    """Full-fidelity call: arbitrary history, optional tools, raw reply."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise LLMUnavailableError("OPENAI_API_KEY is not set")

    body: dict[str, Any] = {
        "model": os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL,
        "max_completion_tokens": max_tokens,
        "messages": messages,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if tools:
        body["tools"] = tools

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                OPENAI_CHAT_COMPLETIONS_URL,
                headers={
                    "authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json=body,
            )
    except httpx.TimeoutException:
        raise LLMUnavailableError(
            f"OpenAI request timed out after {timeout_s}s"
        ) from None
    except httpx.HTTPError as error:
        raise LLMUnavailableError(f"OpenAI request failed: {error}") from None

    if response.status_code >= 400:
        raise LLMUnavailableError(
            f"OpenAI API returned {response.status_code}: {response.text}"
        )

    try:
        payload = response.json()
    except ValueError:
        raise LLMUnavailableError("OpenAI API returned a non-JSON body") from None

    choices = payload.get("choices") or []
    if not choices:
        raise LLMUnavailableError("OpenAI API response contained no choices")

    message = choices[0].get("message") or {}
    tool_calls = [
        ToolCall(
            id=call.get("id", ""),
            name=(call.get("function") or {}).get("name", ""),
            arguments=(call.get("function") or {}).get("arguments", "") or "",
        )
        for call in (message.get("tool_calls") or [])
    ]

    return LLMReply(
        content=message.get("content"),
        toolCalls=tool_calls,
        finishReason=choices[0].get("finish_reason"),
    )


_FENCE_START = re.compile(r"^```(?:json)?[ \t]*\r?\n?", re.IGNORECASE)
_FENCE_END = re.compile(r"\r?\n?[ \t]*```$")


def parse_json_response(raw: str) -> Any:
    """Parses JSON that may be wrapped in ```json / ``` fences.

    Raises whatever json.loads raises when the payload is not valid JSON, so the
    caller can convert it into LLMUnavailableError and fall back.
    """
    cleaned = _FENCE_END.sub("", _FENCE_START.sub("", raw.strip())).strip()
    return json.loads(cleaned)
