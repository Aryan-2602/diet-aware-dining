"""Typed failures for the discovery path.

The original implementation returned an empty list for every failure -- a
geocode miss, an Overpass 504, a rate limit and a genuinely empty result set
were indistinguishable, and the API reported all of them as
``status: "complete"`` with zero results. These types exist so each outcome can
reach the user as itself.
"""

from __future__ import annotations

from typing import Literal

DiscoveryErrorCode = Literal[
    "geocode_failed",
    "geocode_unavailable",
    "overpass_unavailable",
    "overpass_timeout",
]


class DiscoveryError(Exception):
    """A failure in the discovery path, carrying a machine-readable code."""

    def __init__(self, code: DiscoveryErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: DiscoveryErrorCode = code
        self.message = message


class GeocodeFailedError(DiscoveryError):
    """The location string did not resolve to anywhere real. User-fixable."""

    def __init__(self, location: str) -> None:
        super().__init__(
            "geocode_failed", f'Could not find a place called "{location}"'
        )


class LLMUnavailableError(Exception):
    """Raised whenever the LLM cannot produce a usable answer.

    Missing API key, non-2xx response, timeout, network failure, or an
    unparseable payload. Callers rely on this specific type to decide whether to
    fall back to a deterministic path, so the app keeps working with no key.
    """
