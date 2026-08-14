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

import asyncio
import math
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from ..errors import DiscoveryError
from .diet_tags import cuisine_filter, diet_filters_for_need

#: Every entry MUST serve the whole planet. Many public Overpass instances are
#: regional extracts, and a regional one answers a query outside its region with
#: HTTP 200 and zero elements -- indistinguishable here from "no such restaurant
#: exists", which is the one wrong answer this app must never give someone with
#: a dietary requirement. overpass.osm.ch was measured returning 0 elements for
#: a Los Angeles query that overpass-api.de answered with 5, and is excluded for
#: exactly that reason.
#:
#: Gate any new mirror on a control query with a known non-empty answer, e.g.
#: halal within 10km of Santa Monica (34.0194, -118.4912), which must return >0:
#:
#:   nwr["amenity"~"^(restaurant|cafe|fast_food)$"]["name"]
#:      ["diet:halal"~"^(yes|only)$"](around:10000,34.0194,-118.4912);
OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    # overpass-api.de allows 2 slots per IP and returns 504s under load; this
    # mirror was verified serving correctly while the primary was saturated.
    "https://overpass.kumi.systems/api/interpreter",
)

# Timeouts scale with the radius because the query cost does. Measured against
# a healthy mirror for a two-need filter around Santa Monica: 3.8s at 2km, ~9s
# at 10km, 13.8s at 25km. A flat 12s budget therefore could not express "no
# such restaurant within 25km" -- the widest rung, the one that settles the
# question, timed out every time and a definitive empty answer was reported as
# an outage.
BASE_TIMEOUT_S = 10.0
TIMEOUT_PER_KM_S = 0.6
MAX_TIMEOUT_S = 28.0

# The second mirror is only brought up if the first has gone quiet for this
# long. Firing both immediately halves latency on paper but doubles the load on
# a free service, and Overpass answers with HTTP 429 once a client is too
# eager -- which is itself indistinguishable from an outage at this layer.
# Hedging keeps the failover but pays for it only when the first mirror stalls.
HEDGE_DELAY_S = 5.0

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


def timeout_for_radius(radius_m: float) -> float:
    """Seconds to allow a query covering ``radius_m``.

    Used for both the client deadline and Overpass's own ``[timeout:]``, so the
    two cannot disagree -- a server timeout longer than the client's wastes the
    work, and a shorter one turns a completable query into a ``remark``.
    """
    return min(MAX_TIMEOUT_S, BASE_TIMEOUT_S + (radius_m / 1000.0) * TIMEOUT_PER_KM_S)


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
            f"[out:json][timeout:{round(timeout_for_radius(radius_m))}];",
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
    payload = await _fetch_with_mirrors(query, timeout_for_radius(radius_m))
    return _parse_elements(payload.get("elements") or [])


async def _fetch_with_mirrors(query: str, timeout_s: float) -> dict[str, Any]:
    """Tries the mirrors with a hedge, and returns the first success.

    The mirrors saturate independently and per-query -- measured across one
    radius ladder, overpass-api.de answered the 2km query in 2.5s then 504'd on
    5km while kumi.systems did the reverse -- so failover is worth having. But
    a strict chain makes a healthy mirror wait out a dead one's full timeout,
    and firing both at once doubles the load on a free service into HTTP 429s.

    So the next mirror starts only once the previous has been quiet for
    HEDGE_DELAY_S, or immediately if it has already failed. The common case
    costs one request; a stall costs two and overlaps them.
    """
    tasks: set[asyncio.Task[dict[str, Any]]] = set()
    last_error: Optional[DiscoveryError] = None
    try:
        for index, url in enumerate(OVERPASS_MIRRORS):
            tasks.add(asyncio.create_task(_fetch_overpass(url, query, timeout_s)))
            is_last = index == len(OVERPASS_MIRRORS) - 1

            while tasks:
                done, tasks = await asyncio.wait(
                    tasks,
                    timeout=None if is_last else HEDGE_DELAY_S,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    break  # still working -- bring the next mirror up alongside it

                for task in done:
                    error = task.exception()
                    if error is None:
                        return task.result()
                    if not isinstance(error, DiscoveryError):
                        raise error
                    last_error = error

                if not tasks:
                    break  # everything in flight failed -- escalate now, do not wait
    finally:
        # Losers are cancelled and reaped so a stalled mirror cannot outlive the
        # request or surface as a never-retrieved task exception.
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    raise last_error or DiscoveryError(
        "overpass_unavailable", "No Overpass mirror responded"
    )


async def _fetch_overpass(
    url: str, query: str, timeout_s: float
) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                url,
                data={"data": query},
                headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            )
    except httpx.TimeoutException:
        raise DiscoveryError(
            "overpass_timeout", f"Overpass timed out after {timeout_s:.0f}s"
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
