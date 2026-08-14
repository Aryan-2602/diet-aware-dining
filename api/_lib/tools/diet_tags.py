"""The mapping between this app's controlled vocabulary and OpenStreetMap tags.

This module is pure and has no I/O. It is the single place where "does this
restaurant satisfy the user's dietary requirement" is decided, so it is
deliberately kept out of any LLM's reach and is the primary unit-test target.
"""

from __future__ import annotations

import re

#: OSM values that count as a positive dietary claim.
POSITIVE_DIET_VALUES: tuple[str, ...] = ("yes", "only")

#: The complete controlled vocabulary. Anything outside this list is rejected
#: wherever dietary needs enter the system -- UI chips, LLM output,
#: clarification answers -- because a need with no mapping matches no OSM tag
#: and would zero out every result under the hard filter.
DIETARY_VOCABULARY: tuple[str, ...] = (
    "vegan",
    "vegetarian",
    "gluten-free",
    "dairy-free",
    "keto",
    "halal",
    "kosher",
    "paleo",
    "nut-free",
)

#: Each need maps to the OSM tags that can satisfy it. Multiple entries are
#: alternatives (OR) -- the implications are factual, not heuristic: food that
#: is vegan is by definition also vegetarian and free of dairy.
#:
#: Needs absent from this table cannot be expressed in OSM at all. They must
#: never be silently dropped -- see :func:`partition_needs`.
DIET_TAG_ALTERNATIVES: dict[str, list[str]] = {
    "vegan": ["diet:vegan"],
    "vegetarian": ["diet:vegetarian", "diet:vegan"],
    "dairy-free": ["diet:lactose_free", "diet:vegan"],
    "gluten-free": ["diet:gluten_free"],
    "halal": ["diet:halal"],
    "kosher": ["diet:kosher"],
    # keto, paleo, nut-free: OSM has no tag for these.
}

#: OSM ``cuisine`` values for each vocabulary term. Used to build the query
#: regex from a lookup table rather than from raw user text -- which both fixes
#: the mismatches (OSM writes ``middle_eastern``, not ``middle eastern``) and
#: removes the query-injection surface entirely.
CUISINE_OSM_VALUES: dict[str, list[str]] = {
    "italian": ["italian", "pizza", "pasta"],
    "mexican": ["mexican", "tacos", "burrito", "tex-mex"],
    "chinese": ["chinese", "dim_sum", "szechuan", "cantonese"],
    "japanese": ["japanese", "sushi", "ramen", "teriyaki", "izakaya"],
    "indian": ["indian", "curry", "tandoori", "punjabi", "south_indian"],
    "thai": ["thai"],
    "korean": ["korean", "korean_bbq"],
    "mediterranean": [
        "mediterranean",
        "greek",
        "gyros",
        "falafel",
        "turkish",
        "lebanese",
    ],
    # `new_american` is genuinely American cuisine and is included
    # deliberately. `latin_american` is not, and is deliberately excluded --
    # the old unanchored substring regex matched both by accident.
    "american": [
        "american",
        "new_american",
        "burger",
        "barbecue",
        "diner",
        "steak_house",
    ],
    "french": ["french", "crepe", "bistro"],
    "vietnamese": ["vietnamese", "pho", "banh_mi"],
    "greek": ["greek", "gyros", "souvlaki"],
    "middle eastern": [
        "middle_eastern",
        "lebanese",
        "arab",
        "persian",
        "turkish",
        "falafel",
        "shawarma",
        "kebab",
    ],
    "ethiopian": ["ethiopian", "eritrean"],
    "caribbean": ["caribbean", "jamaican", "cuban"],
}


def is_known_need(value: str) -> bool:
    return value in DIETARY_VOCABULARY


def partition_needs(needs: list[str]) -> tuple[list[str], list[str]]:
    """Split needs into (enforceable, unenforceable).

    Enforceable needs are hard-filtered. Unenforceable ones are surfaced as
    warnings -- never silently dropped, which is what made the old "nut-free"
    filter chip a lie.
    """
    enforceable: list[str] = []
    unenforceable: list[str] = []
    for need in needs:
        if need in DIET_TAG_ALTERNATIVES:
            enforceable.append(need)
        else:
            unenforceable.append(need)
    return enforceable, unenforceable


def satisfies_need(tags: dict[str, str], need: str) -> bool:
    """True when ``tags`` carries a positive value for at least one alternative."""
    alternatives = DIET_TAG_ALTERNATIVES.get(need)
    if not alternatives:
        return False
    return any(tags.get(tag) in POSITIVE_DIET_VALUES for tag in alternatives)


def matches_all_needs(tags: dict[str, str], enforceable_needs: list[str]) -> bool:
    """The hard safety predicate: every enforceable need must be evidenced.

    Absence of a tag is never treated as a pass -- "we don't know" and "yes" are
    different answers, and only one of them is safe to show.
    """
    return all(satisfies_need(tags, need) for need in enforceable_needs)


def diet_tag_strength(tags: dict[str, str], enforceable_needs: list[str]) -> float:
    """Strength of the dietary evidence, 0..1.

    ``only`` (the whole establishment is vegan) is stronger evidence than
    ``yes`` (some options are).
    """
    if not enforceable_needs:
        return 0.0

    per_need: list[float] = []
    for need in enforceable_needs:
        values = [
            tags[tag]
            for tag in DIET_TAG_ALTERNATIVES.get(need, [])
            if tags.get(tag)
        ]
        if "only" in values:
            per_need.append(1.0)
        elif "yes" in values:
            per_need.append(0.8)
        else:
            per_need.append(0.0)
    return sum(per_need) / len(per_need)


def extract_diet_tags(tags: dict[str, str]) -> dict[str, str]:
    """The ``diet:*`` tags actually present, for display and evidence."""
    return {k: v for k, v in tags.items() if k.startswith("diet:")}


def diet_filters_for_need(need: str) -> list[str]:
    """Overpass tag filters for one need, as alternatives.

    Returns one filter string per alternative tag; the caller decides how to
    combine them.
    """
    values = "|".join(POSITIVE_DIET_VALUES)
    return [
        f'["{tag}"~"^({values})$"]' for tag in DIET_TAG_ALTERNATIVES.get(need, [])
    ]


def cuisine_filter(cuisine_type: str) -> str | None:
    """An anchored Overpass regex filter for a cuisine term.

    OSM stores multiple cuisines semicolon-separated (``cuisine=japanese;ramen``),
    so alternatives are anchored to ``;`` or string boundaries rather than
    matched as substrings.
    """
    values = CUISINE_OSM_VALUES.get(cuisine_type)
    if not values:
        return None
    alternation = "|".join(re.escape(v) for v in values)
    return f'["cuisine"~"(^|;)[ ]*({alternation})[ ]*($|;)",i]'


def cuisine_matches(cuisines: list[str], cuisine_type: str | None) -> bool:
    """True when a restaurant's parsed cuisine list matches the requested term."""
    if not cuisine_type:
        return False
    values = CUISINE_OSM_VALUES.get(cuisine_type)
    if not values:
        return False
    return any(c.strip().lower() in values for c in cuisines)
