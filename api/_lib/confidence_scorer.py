"""Deterministic confidence scoring.

Everything here derives from a real OpenStreetMap signal. The original
implementation multiplied a fabricated rating by a fabricated review count and
added ``0.7 + random()*0.3`` for "recency", which meant the same query returned
a different set of restaurants in a different order on every run. There is no
random component here, and no input that OSM does not actually provide.

The score answers "how well attested is this place's dietary tagging", not
"does this match" -- everything reaching the scorer has already passed the hard
dietary filter.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .tools.diet_tags import diet_tag_strength
from .types import ConfidenceScore, Restaurant

WEIGHT_DIET_TAG_STRENGTH = 0.55
WEIGHT_TAG_RECENCY = 0.20
WEIGHT_COVERAGE = 0.15
WEIGHT_DATA_COMPLETENESS = 0.10

COMPLETENESS_FIELDS = 5


def recency_score(check_date: Optional[str]) -> float:
    """How recently a mapper confirmed the listing.

    Absent means unknown, which scores 0 -- not a middling default. "Nobody has
    checked" is information.
    """
    if not check_date:
        return 0.0
    try:
        parsed = datetime.fromisoformat(check_date.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    years = (datetime.now(timezone.utc) - parsed).days / 365.25
    if years < 0:
        return 0.0  # A future date is bad data, not fresh data.
    if years < 1:
        return 1.0
    if years < 2:
        return 0.7
    if years < 4:
        return 0.4
    return 0.2


def completeness_score(restaurant: Restaurant) -> float:
    """Listing completeness.

    A data-quality signal, deliberately not a popularity or quality one -- OSM
    has no popularity data, and the previous code presented exactly this number
    to users as a star rating.
    """
    present = sum(
        [
            restaurant.address != "Address not in OpenStreetMap",
            bool(restaurant.openingHours),
            bool(restaurant.website),
            bool(restaurant.phone),
            bool(restaurant.cuisine)
            and restaurant.cuisine[0] not in ("restaurant", "cafe"),
        ]
    )
    return present / COMPLETENESS_FIELDS


def score_restaurant(
    restaurant: Restaurant, enforceable_needs: list[str], all_needs: list[str]
) -> ConfidenceScore:
    strength = diet_tag_strength(restaurant.dietTags, enforceable_needs)
    recency = recency_score(restaurant.lastCheckedISO)
    # Nothing was asked for, so nothing is unverified.
    coverage = 1.0 if not all_needs else len(enforceable_needs) / len(all_needs)
    completeness = completeness_score(restaurant)

    # With no enforceable need there is no dietary evidence to weigh, so that
    # term is dropped and the remaining weights are renormalized rather than
    # dragging every score toward zero.
    if enforceable_needs:
        applicable = [
            (strength, WEIGHT_DIET_TAG_STRENGTH),
            (recency, WEIGHT_TAG_RECENCY),
            (coverage, WEIGHT_COVERAGE),
            (completeness, WEIGHT_DATA_COMPLETENESS),
        ]
    else:
        applicable = [
            (recency, WEIGHT_TAG_RECENCY),
            (coverage, WEIGHT_COVERAGE),
            (completeness, WEIGHT_DATA_COMPLETENESS),
        ]

    total_weight = sum(w for _, w in applicable)
    weighted = sum(value * w for value, w in applicable)
    overall = weighted / total_weight if total_weight > 0 else 0.0

    return ConfidenceScore(
        restaurantId=restaurant.id,
        overall=_round(overall),
        dietTagStrength=_round(strength),
        coverage=_round(coverage),
        tagRecency=_round(recency),
        dataCompleteness=_round(completeness),
    )


def score_restaurants(
    restaurants: list[Restaurant], enforceable_needs: list[str], all_needs: list[str]
) -> list[ConfidenceScore]:
    return [
        score_restaurant(r, enforceable_needs, all_needs) for r in restaurants
    ]


def _round(value: float) -> float:
    return round(value * 100) / 100
