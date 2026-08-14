"""Overpass search.

The original query was ``node/way["amenity"=restaurant|cafe] ... out center 30;``
with the dietary filter computed and then discarded. Two consequences, both
measured against live data:

- ``out center 30`` returns the 30 *lowest OSM ids* -- the oldest objects, not
  the nearest. Zero of the true 15 nearest restaurants appeared, and the
  ``way[...]`` clauses were dead code because 30 nodes filled the quota first,
  making every building-mapped restaurant invisible.
- Without the diet filter, "vegan" searched the same 30 arbitrary places as
  "restaurants", so tagged vegan places usually were not even candidates.

Filtering on ``diet:*`` server-side cuts a 927-place city radius to ~36, which
is what makes a single wide query affordable and why the hard filter *increases*
useful results rather than emptying them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from ..errors import DiscoveryError
from .diet_tags import cuisine_filter, diet_filters_for_need

OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    # overpass-api.de allows 2 slots per IP and returns 504s under load; this
    # mirror was verified serving correctly while the primary was saturated.
    "https://overpass.kumi.systems/api/interpreter",
)

# Kept tight deliberately: the mirrors are tried in sequence, so this bounds the
# worst case at roughly 2x. Overpass answers a diet-filtered query in well under
# a second when healthy; a slow response means it is saturated, and failing over
# to the next mirror beats waiting.
TIMEOUT_S = 12.0
SERVER_TIMEOUT_S = 12
MAX_ELEMENTS = 200
MAX_STATEMENTS = 8
AMENITIES = ("restaurant", "cafe", "fast_food")

USER_AGENT = (
    "DietAwareDining/2.0 (https://github.com/Aryan-2602/diet-aware-dining)"
)


@dataclass
class OverpassPlace:
    osmType: str
    osmId: int
    lat: float
    lng: float
    tags: dict[str, str]


def diet_filter_combinations(needs: list[str]) -> list[list[str]]:
    """The cross-product of each need's alternative tags.

    A need like ``vegetarian`` is satisfied by ``diet:vegetarian`` OR
    ``diet:vegan``, and Overpass has no OR within a statement -- so alternatives
    become separate union statements while multiple needs AND together as
    repeated filters on one statement.
    """
    combos: list[list[str]] = [[]]
    for need in needs:
        alternatives = diet_filters_for_need(need)
        if not alternatives:
            continue
        combos = [combo + [alt] for combo in combos for alt in alternatives]

    # Degrade to strict AND rather than emitting an unbounded union.
    if len(combos) > MAX_STATEMENTS:
        strict = [
            diet_filters_for_need(need)[0]
            for need in needs
            if diet_filters_for_need(need)
        ]
        return [strict]
    return combos


def build_overpass_query(
    lat: float,
    lng: float,
    radius_m: float,
    diet_needs: list[str],
    cuisine_type: Optional[str] = None,
) -> str:
    amenity = f'["amenity"~"^({"|".join(AMENITIES)})$"]'
    around = f"(around:{round(radius_m)},{lat},{lng})"

    # Cuisine is a *soft* preference: 22% of places carry no `cuisine` tag at
    # all, including vegan ones, so filtering on it server-side silently
    # discards valid matches. It is only used to bound the query when there is
    # no diet filter doing that job.
    cuisine = ""
    if not diet_needs and cuisine_type:
        cuisine = cuisine_filter(cuisine_type) or ""

    statements = [
        f'  nwr{amenity}["name"]{"".join(filters)}{cuisine}{around};'
        for filters in diet_filter_combinations(diet_needs)
    ]

    return "\n".join(
        [
            f"[out:json][timeout:{SERVER_TIMEOUT_S}];",
            "(",
            *statements,
            ");",
            f"out tags center {MAX_ELEMENTS};",
        ]
    )


async def search_restaurants(
    lat: float,
    lng: float,
    radius_m: float,
    diet_needs: list[str],
    cuisine_type: Optional[str] = None,
) -> list[OverpassPlace]:
    query = build_overpass_query(lat, lng, radius_m, diet_needs, cuisine_type)
    payload = await _fetch_with_mirrors(query)
    return _parse_elements(payload.get("elements") or [])


async def _fetch_with_mirrors(query: str) -> dict[str, Any]:
    last_error: Optional[DiscoveryError] = None
    for url in OVERPASS_MIRRORS:
        try:
            return await _fetch_overpass(url, query)
        except DiscoveryError as error:
            last_error = error
            continue
    raise last_error or DiscoveryError(
        "overpass_unavailable", "No Overpass mirror responded"
    )


async def _fetch_overpass(url: str, query: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            response = await client.post(
                url,
                data={"data": query},
                headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            )
    except httpx.TimeoutException:
        raise DiscoveryError(
            "overpass_timeout", f"Overpass timed out after {TIMEOUT_S}s"
        ) from None
    except httpx.HTTPError as error:
        raise DiscoveryError("overpass_unavailable", str(error)) from None

    if response.status_code >= 400:
        raise DiscoveryError(
            "overpass_unavailable", f"Overpass returned {response.status_code}"
        )

    # Overpass answers a rate-limited request with HTTP 200 and an XHTML error
    # page. Parsing that as "zero elements" is what turned rate limits into
    # "no restaurants found".
    content_type = response.headers.get("content-type", "")
    if "json" not in content_type:
        raise DiscoveryError(
            "overpass_unavailable",
            f"Overpass returned {content_type or 'an unknown content type'} "
            "instead of JSON (usually rate limiting)",
        )

    try:
        payload = response.json()
    except ValueError:
        raise DiscoveryError(
            "overpass_unavailable", "Overpass returned a malformed JSON body"
        ) from None

    # A `remark` signals a server-side timeout or truncation. Treating it as an
    # empty result set reports partial data as complete.
    if payload.get("remark"):
        raise DiscoveryError(
            "overpass_timeout", f"Overpass reported: {payload['remark']}"
        )

    return payload


def _parse_elements(elements: list[dict[str, Any]]) -> list[OverpassPlace]:
    places: list[OverpassPlace] = []
    for element in elements:
        tags = element.get("tags") or {}
        lat = element.get("lat")
        lng = element.get("lon")
        center = element.get("center") or {}
        if lat is None:
            lat = center.get("lat")
        if lng is None:
            lng = center.get("lon")

        osm_type = element.get("type")
        if (
            lat is None
            or lng is None
            or not tags.get("name")
            or osm_type not in ("node", "way", "relation")
        ):
            continue

        places.append(
            OverpassPlace(
                osmType=osm_type,
                osmId=int(element["id"]),
                lat=float(lat),
                lng=float(lng),
                tags=tags,
            )
        )
    return places


def distance_meters(
    from_lat: float, from_lng: float, to_lat: float, to_lng: float
) -> int:
    """Metres between two coordinates (haversine)."""
    radius = 6_371_000
    d_lat = math.radians(to_lat - from_lat)
    d_lon = math.radians(to_lng - from_lng)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(from_lat))
        * math.cos(math.radians(to_lat))
        * math.sin(d_lon / 2) ** 2
    )
    return round(2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a)))
