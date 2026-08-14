"""Nominatim geocoding.

Two things the original implementation got wrong and this one does not: it
distinguished nothing (a 500 and "no such place" both became ``None``, then an
empty list, then "no restaurants found"), and it re-ran on every relaxation
attempt, issuing three requests per search against a service whose usage policy
allows one per second.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

import httpx

from ..errors import DiscoveryError, GeocodeFailedError
from . import cache

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
TIMEOUT_S = 5.0
USER_AGENT = (
    "DietAwareDining/2.0 (https://github.com/Aryan-2602/diet-aware-dining)"
)


@dataclass
class GeocodeResult:
    lat: float
    lng: float
    displayName: str
    boundingBox: Optional[list[float]] = None


#: Process-lifetime cache. Repeat searches for a city cost one request, not N.
_cache: dict[str, GeocodeResult] = {}


async def geocode(location: str) -> GeocodeResult:
    key = location.strip().lower()
    if not key:
        raise GeocodeFailedError(location)

    cached = _cache.get(key)
    if cached is not None:
        return cached

    # The dict above only survives within one warm instance, which on serverless
    # is close to never. The shared cache is what actually keeps repeat searches
    # for a city inside Nominatim's one-request-per-second policy.
    shared_key = cache.key_for("geocode", key)
    stored = await cache.read(shared_key)
    if stored is not None:
        result = GeocodeResult(**stored)
        _cache[key] = result
        return result

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            response = await client.get(
                NOMINATIM_URL,
                params={
                    "q": location,
                    "format": "json",
                    "limit": "1",
                    "addressdetails": "0",
                },
                headers={
                    # Nominatim's policy requires an identifiable app with
                    # contact info.
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as error:
        raise DiscoveryError(
            "geocode_unavailable",
            f"Could not reach the geocoding service: {error}",
        ) from None

    if response.status_code >= 400:
        raise DiscoveryError(
            "geocode_unavailable",
            f"Geocoding service returned {response.status_code}",
        )

    try:
        entries = response.json()
    except ValueError:
        raise DiscoveryError(
            "geocode_unavailable",
            "Geocoding service returned a non-JSON response",
        ) from None

    # An empty list is a real answer -- the place does not exist -- and is a
    # different outcome from the service being down.
    if not isinstance(entries, list) or not entries:
        raise GeocodeFailedError(location)

    entry = entries[0]
    try:
        lat = float(entry["lat"])
        lng = float(entry["lon"])
    except (KeyError, TypeError, ValueError):
        raise GeocodeFailedError(location) from None

    bbox = entry.get("boundingbox")
    result = GeocodeResult(
        lat=lat,
        lng=lng,
        displayName=entry.get("display_name", location),
        boundingBox=[float(v) for v in bbox] if bbox else None,
    )
    _cache[key] = result
    # A city's coordinates are effectively immutable, so this is cached for
    # much longer than restaurant data.
    await cache.write(shared_key, asdict(result), ttl_s=30 * 24 * 60 * 60)
    return result
