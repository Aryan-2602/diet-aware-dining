"""Per-request correlation id.

A search fans out across the intent agent, discovery, Overpass with its mirror
failover, the geocoder and the cache -- each of which already logs warnings.
Until now those lines arrived with nothing tying them together, so on a
serverless platform handling concurrent requests there was no way to tell which
search a "rung failed, widening" or "cache read failed" line belonged to.

A ``ContextVar`` rather than a parameter threaded through call signatures:
context variables propagate automatically into every coroutine awaited from the
request, so existing log calls deep in the stack pick the id up without being
rewritten.
"""

from __future__ import annotations

import uuid
from contextvars import ContextVar

#: Defaults to "-" so a log call outside any request -- module import, a
#: background task, the test suite -- formats cleanly instead of raising
#: LookupError.
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def new_request_id() -> str:
    """A short id. Eight hex chars is plenty to disambiguate concurrent runs."""
    return uuid.uuid4().hex[:8]


def set_request_id(value: str) -> None:
    _request_id.set(value)


def get_request_id() -> str:
    return _request_id.get()
