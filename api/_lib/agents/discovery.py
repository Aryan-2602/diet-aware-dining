"""Restaurant Discovery.

Deterministic by design. Which restaurants a person is shown must be
reproducible, so every decision here -- radius, filtering, ordering -- is made
in code. The dietary constraint is applied in the Overpass query and re-asserted
after parsing.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

from ..errors import DiscoveryError
from ..tools.diet_tags import (
    cuisine_matches,
    extract_diet_tags,
    matches_all_needs,
    partition_needs,
)
from ..tools.geocode import GeocodeResult, geocode
from ..tools.overpass import OverpassPlace, distance_meters, search_restaurants
from ..types import Coordinates, ParsedIntent, Restaurant

# Fixed ladder. Widening when there are too few matches is a mechanical decision
# with one correct answer, so it lives in code: an earlier revision let a
# planning agent choose the radius and the end-to-end eval caught it
# immediately -- two runs of the same query picked different radii and returned
# different restaurants. Anything that changes *which* restaurants a person sees
# has to be reproducible.
RADIUS_LADDER_M = (2000, 5000, 10_000, 25_000)
MIN_RESULTS = 3
MAX_RESULTS = 15

# The whole ladder has to fit inside the 60s function limit with the geocode,
# the LLM intent call and scoring alongside it. Each rung is bounded by the
# Overpass client timeout, so stopping before a rung that cannot finish keeps
# the worst case at roughly this budget plus one rung.
SEARCH_BUDGET_S = 40.0

logger = logging.getLogger(__name__)

DIET_TAG_LABELS = {
    "diet:vegan": "vegan",
    "diet:vegetarian": "vegetarian",
    "diet:gluten_free": "gluten-free",
    "diet:lactose_free": "dairy-free",
    "diet:halal": "halal",
    "diet:kosher": "kosher",
}


@dataclass
class DiscoveryOutcome:
    restaurants: list[Restaurant]
    #: Needs OSM could not express, so could not be filtered on.
    unenforceableNeeds: list[str]
    enforceableNeeds: list[str]
    #: Tightest radius yielding MIN_RESULTS, else the widest tried.
    effectiveRadiusM: int
    radiusSearchedM: int
    candidatesScanned: int
    geocoded: GeocodeResult


class RestaurantDiscoveryAgent:
    async def process(self, intent: ParsedIntent) -> DiscoveryOutcome:
        """Geocode once, then Overpass with a widening radius ladder."""
        # Geocoding happens exactly once. The original implementation
        # re-geocoded inside its relaxation recursion, issuing three requests
        # per search against a 1-req/s service.
        geocoded = await geocode(intent.location)
        enforceable, unenforceable = partition_needs(intent.dietaryNeeds)

        places, radius_searched = await self._search_with_ladder(
            intent, geocoded, enforceable
        )

        restaurants = self._to_restaurants(places, intent, enforceable, geocoded)

        return DiscoveryOutcome(
            restaurants=restaurants[:MAX_RESULTS],
            unenforceableNeeds=unenforceable,
            enforceableNeeds=enforceable,
            effectiveRadiusM=self._tightest_useful_radius(
                restaurants, radius_searched
            ),
            radiusSearchedM=radius_searched,
            candidatesScanned=len(places),
            geocoded=geocoded,
        )

    async def _search_with_ladder(
        self,
        intent: ParsedIntent,
        geocoded: GeocodeResult,
        enforceable_needs: list[str],
    ) -> tuple[list[OverpassPlace], int]:
        """Widens until there are enough matches.

        Deterministic: the same query at the same moment always issues the same
        sequence of requests and returns the same restaurants. The diet filter
        is what makes this affordable -- it cuts a city radius from hundreds of
        places to tens, so the widest step is still a small response.

        A rung that fails does not end the search. Overpass saturates per-query,
        not per-session, so a 504 on the 5 km rung says nothing about the 10 km
        one -- "halal near Santa Monica" measured as 0 results at 2 km, both
        mirrors 504 at 5 km, then 5 results at 10 km. Aborting on the middle
        rung reported an outage for a search whose answer was one rung away.
        """
        places: list[OverpassPlace] = []
        radius_searched = RADIUS_LADDER_M[0]
        last_error: Optional[DiscoveryError] = None
        deadline = time.monotonic() + SEARCH_BUDGET_S

        for radius_m in RADIUS_LADDER_M:
            if time.monotonic() >= deadline:
                logger.warning(
                    "[Discovery] search budget spent, stopping before the %dm rung",
                    radius_m,
                )
                break

            try:
                found = await search_restaurants(
                    lat=geocoded.lat,
                    lng=geocoded.lng,
                    radius_m=radius_m,
                    diet_needs=enforceable_needs,
                    cuisine_type=intent.cuisineType,
                )
            except DiscoveryError as error:
                # Held rather than raised: a wider rung may still answer, and if
                # none does the decision below distinguishes "nothing matched"
                # from "the search never completed".
                last_error = error
                logger.warning(
                    "[Discovery] %dm rung failed (%s), widening: %s",
                    radius_m,
                    error.code,
                    error.message,
                )
                continue

            places = found
            radius_searched = radius_m
            usable = [
                p for p in places if matches_all_needs(p.tags, enforceable_needs)
            ]
            if len(usable) >= MIN_RESULTS:
                break

        # Degrading to a partial answer is only honest while there is something
        # to show. With nothing to show and a rung that never completed, the
        # search did not establish an absence -- reporting "no restaurants
        # found" would be the outage-as-empty-result bug this codebase exists
        # to avoid.
        if last_error is not None and not any(
            matches_all_needs(p.tags, enforceable_needs) for p in places
        ):
            raise last_error

        return places, radius_searched

    def _to_restaurants(
        self,
        places: list[OverpassPlace],
        intent: ParsedIntent,
        enforceable_needs: list[str],
        center: GeocodeResult,
    ) -> list[Restaurant]:
        """Maps Overpass elements to Restaurants and re-asserts the filter.

        Defence in depth: the query already filtered, but a stale mirror, a
        future edit to the query builder, or ``out`` truncation must not be able
        to put an unverified place in front of someone with a dietary
        requirement.
        """
        restaurants: list[Restaurant] = []
        for place in places:
            if not matches_all_needs(place.tags, enforceable_needs):
                continue
            tags = place.tags
            restaurants.append(
                Restaurant(
                    # node and way ids occupy separate namespaces and collide
                    # without the type prefix, which previously
                    # cross-contaminated evidence between results.
                    id=f"osm-{place.osmType}-{place.osmId}",
                    name=tags["name"],
                    address=self._build_address(tags),
                    cuisine=self._extract_cuisine(tags),
                    dietaryOptions=self._extract_dietary_options(tags),
                    dietTags=extract_diet_tags(tags),
                    location=Coordinates(lat=place.lat, lng=place.lng),
                    osmType=place.osmType,  # type: ignore[arg-type]
                    osmId=place.osmId,
                    distance=distance_meters(
                        center.lat, center.lng, place.lat, place.lng
                    ),
                    openingHours=tags.get("opening_hours"),
                    website=tags.get("website") or tags.get("contact:website"),
                    phone=tags.get("phone") or tags.get("contact:phone"),
                    lastCheckedISO=self._extract_check_date(tags),
                )
            )

        # Requested cuisine first (a preference, not a constraint), then
        # distance, then id. Distances are whole metres so exact ties happen;
        # without the final tie-break their order is whatever Overpass returned.
        restaurants.sort(
            key=lambda r: (
                0 if cuisine_matches(r.cuisine, intent.cuisineType) else 1,
                r.distance if r.distance is not None else float("inf"),
                r.id,
            )
        )
        return restaurants

    def _extract_check_date(self, tags: dict[str, str]) -> Optional[str]:
        """Prefers a need-specific check date over the listing-wide one."""
        for key, value in tags.items():
            if key.startswith("check_date:diet:") and value:
                return value
        return tags.get("check_date") or tags.get("survey:date")

    def _extract_dietary_options(self, tags: dict[str, str]) -> list[str]:
        return [
            label
            for tag, label in DIET_TAG_LABELS.items()
            if tags.get(tag) in ("yes", "only")
        ]

    def _extract_cuisine(self, tags: dict[str, str]) -> list[str]:
        raw = tags.get("cuisine") or tags.get("food") or ""
        if not raw:
            return ["cafe" if tags.get("amenity") == "cafe" else "restaurant"]
        return [c.strip().lower() for c in raw.split(";") if c.strip()]

    def _build_address(self, tags: dict[str, str]) -> str:
        parts = [
            tags.get("addr:housenumber"),
            tags.get("addr:street"),
            tags.get("addr:city"),
            tags.get("addr:postcode"),
        ]
        present = [p for p in parts if p]
        return ", ".join(present) if present else "Address not in OpenStreetMap"

    def _tightest_useful_radius(
        self, restaurants: list[Restaurant], searched_m: int
    ) -> int:
        """The tightest radius still containing MIN_RESULTS, for honest reporting."""
        for radius in RADIUS_LADDER_M:
            if radius > searched_m:
                break
            within = [
                r
                for r in restaurants
                if (r.distance if r.distance is not None else float("inf")) <= radius
            ]
            if len(within) >= MIN_RESULTS:
                return radius
        return searched_m
