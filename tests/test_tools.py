"""Tests for the pure functions that decide dietary safety and ranking.

These are the functions worth testing above all others: everything else in the
pipeline is presentation or I/O, but a bug here shows someone a restaurant that
does not meet their dietary requirement.

Ported 1:1 from the TypeScript suite so parity is checkable assertion by
assertion. Run with ``pytest``.
"""

from __future__ import annotations

import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api._lib.confidence_scorer import (  # noqa: E402
    completeness_score,
    recency_score,
    score_restaurant,
)
from api._lib.tools.diet_tags import (  # noqa: E402
    cuisine_filter,
    cuisine_matches,
    diet_tag_strength,
    is_known_need,
    matches_all_needs,
    partition_needs,
)
from api._lib.tools.overpass import (  # noqa: E402
    build_overpass_query,
    diet_filter_combinations,
)
from api._lib.types import Coordinates, Restaurant  # noqa: E402

FIXTURE = (
    pathlib.Path(__file__).resolve().parents[1]
    / "fixtures"
    / "overpass-seattle-vegan.json"
)


def restaurant(**overrides) -> Restaurant:
    base = dict(
        id="osm-node-1",
        name="Test",
        address="1 Test St",
        cuisine=["vegan"],
        dietaryOptions=["vegan"],
        dietTags={"diet:vegan": "yes"},
        location=Coordinates(0.0, 0.0),
        osmType="node",
        osmId=1,
    )
    base.update(overrides)
    return Restaurant(**base)  # type: ignore[arg-type]


# --- Dietary safety predicate -------------------------------------------


def test_positive_tag_satisfies_need():
    assert matches_all_needs({"diet:vegan": "yes"}, ["vegan"]) is True


def test_only_also_satisfies_need():
    assert matches_all_needs({"diet:vegan": "only"}, ["vegan"]) is True


def test_missing_tag_never_passes():
    """'unknown' and 'yes' are different answers; only one is safe to show."""
    assert matches_all_needs({}, ["vegan"]) is False
    assert matches_all_needs({"amenity": "restaurant"}, ["vegan"]) is False


def test_explicit_no_is_rejected():
    assert matches_all_needs({"diet:vegan": "no"}, ["vegan"]) is False


def test_limited_is_rejected():
    assert matches_all_needs({"diet:vegan": "limited"}, ["vegan"]) is False


def test_every_need_must_be_satisfied_not_any():
    tags = {"diet:vegan": "yes"}
    assert matches_all_needs(tags, ["vegan", "gluten-free"]) is False
    assert (
        matches_all_needs(
            {**tags, "diet:gluten_free": "yes"}, ["vegan", "gluten-free"]
        )
        is True
    )


def test_vegan_implies_vegetarian():
    assert matches_all_needs({"diet:vegan": "yes"}, ["vegetarian"]) is True


def test_vegan_implies_dairy_free():
    assert matches_all_needs({"diet:vegan": "yes"}, ["dairy-free"]) is True


def test_vegetarian_does_not_imply_vegan():
    assert matches_all_needs({"diet:vegetarian": "yes"}, ["vegan"]) is False


def test_unenforceable_need_never_satisfied():
    assert matches_all_needs({"diet:nut_free": "yes"}, ["nut-free"]) is False


# --- Vocabulary ----------------------------------------------------------


def test_partition_splits_by_osm_expressibility():
    enforceable, unenforceable = partition_needs(
        ["vegan", "keto", "gluten-free", "nut-free"]
    )
    assert enforceable == ["vegan", "gluten-free"]
    assert unenforceable == ["keto", "nut-free"]


@pytest.mark.parametrize(
    "junk", ["high-protein", "asian", "jain", "open-now", "bogus"]
)
def test_junk_values_rejected(junk):
    assert is_known_need(junk) is False


def test_real_value_accepted():
    assert is_known_need("vegan") is True


# --- Overpass query construction ----------------------------------------


def test_diet_filter_is_in_the_query():
    q = build_overpass_query(47.6, -122.3, 2000, ["vegan"])
    assert '["diet:vegan"~"^(yes|only)$"]' in q


def test_no_thirty_element_cap():
    """It returned the oldest ids, not the nearest."""
    q = build_overpass_query(47.6, -122.3, 2000, ["vegan"])
    assert "out tags center 200;" in q
    assert "out center 30;" not in q


def test_fast_food_and_nwr_included():
    q = build_overpass_query(47.6, -122.3, 2000, ["vegan"])
    assert "fast_food" in q
    assert "nwr" in q


def test_alternatives_become_a_union():
    combos = diet_filter_combinations(["vegetarian", "gluten-free"])
    assert len(combos) == 2
    assert all(len(combo) == 2 for combo in combos)


def test_cuisine_omitted_when_diet_bounds_the_query():
    q = build_overpass_query(47.6, -122.3, 2000, ["vegan"], "japanese")
    assert "cuisine" not in q


def test_cuisine_used_when_nothing_else_bounds_the_query():
    q = build_overpass_query(47.6, -122.3, 2000, [], "japanese")
    assert "cuisine" in q


# --- Cuisine matching ----------------------------------------------------


def test_middle_eastern_maps_to_osm_spelling():
    f = cuisine_filter("middle eastern")
    assert f is not None and "middle_eastern" in f


def test_american_does_not_match_latin_american():
    assert cuisine_matches(["latin_american"], "american") is False
    assert cuisine_matches(["american"], "american") is True
    assert cuisine_matches(["new_american"], "american") is True


def test_synonyms_widen_the_match():
    assert cuisine_matches(["ramen"], "japanese") is True
    assert cuisine_matches(["sushi"], "japanese") is True


def test_multi_value_cuisine_tags():
    assert cuisine_matches(["japanese", "ramen"], "japanese") is True


# --- Confidence scoring --------------------------------------------------


def test_only_outranks_yes():
    assert diet_tag_strength({"diet:vegan": "only"}, ["vegan"]) > diet_tag_strength(
        {"diet:vegan": "yes"}, ["vegan"]
    )


def test_missing_check_date_scores_zero():
    """Not a middling default -- 'nobody has checked' is information."""
    assert recency_score(None) == 0
    assert recency_score("not-a-date") == 0


def test_recency_decays_with_age():
    recent = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    old = (datetime.now(timezone.utc) - timedelta(days=5 * 365)).date().isoformat()
    assert recency_score(recent) > recency_score(old)


def test_completeness_counts_real_fields_only():
    assert completeness_score(restaurant(cuisine=["restaurant"])) == 1 / 5
    assert (
        completeness_score(
            restaurant(
                openingHours="Mo-Su 09:00-17:00",
                website="https://x.test",
                phone="+1",
                cuisine=["vegan"],
            )
        )
        == 1
    )


def test_scoring_is_deterministic():
    r = restaurant(lastCheckedISO="2025-06-01")
    assert score_restaurant(r, ["vegan"], ["vegan"]) == score_restaurant(
        r, ["vegan"], ["vegan"]
    )


def test_coverage_reports_verifiable_share():
    score = score_restaurant(restaurant(), ["vegan"], ["vegan", "keto"])
    assert score.coverage == 0.5


def test_scores_stay_in_range():
    score = score_restaurant(
        restaurant(
            dietTags={"diet:vegan": "only"},
            lastCheckedISO=datetime.now(timezone.utc).date().isoformat(),
            openingHours="x",
            website="x",
            phone="x",
        ),
        ["vegan"],
        ["vegan"],
    )
    assert 0 < score.overall <= 1


# --- Against a real-shaped Overpass fixture ------------------------------


def from_fixture(needs: list[str]):
    """The deterministic part of discovery, without needing the network.

    Overpass is a shared free service and is regularly saturated, so the
    end-to-end eval skips when it is down -- these assertions never skip.
    """
    raw = json.loads(FIXTURE.read_text())
    out = []
    for el in raw["elements"]:
        tags = el.get("tags") or {}
        if not matches_all_needs(tags, needs):
            continue
        r = restaurant(
            id=f"osm-{el['type']}-{el['id']}",
            name=tags["name"],
            osmType=el["type"],
            osmId=el["id"],
            dietTags={k: v for k, v in tags.items() if k.startswith("diet:")},
            cuisine=str(tags.get("cuisine", "restaurant")).split(";"),
            website=tags.get("website"),
            phone=tags.get("phone"),
            openingHours=tags.get("opening_hours"),
            lastCheckedISO=tags.get("check_date:diet:vegan") or tags.get("check_date"),
            address=tags.get("addr:street", "Address not in OpenStreetMap"),
        )
        out.append((r, score_restaurant(r, needs, needs)))
    out.sort(key=lambda item: -item[1].overall)
    return out


def test_only_positively_tagged_places_survive():
    names = sorted(r.name for r, _ in from_fixture(["vegan"]))
    assert names == [
        "Askatu",
        "Building-Mapped Vegan Kitchen",
        "Mendocino Farms",
        "Voodoo Doughnut",
    ]


@pytest.mark.parametrize(
    "excluded",
    [
        "Explicitly Not Vegan",
        "Only Limited Vegan Options",
        "Untagged Diner",
        "Vegetarian But Not Vegan",
    ],
)
def test_non_matching_places_are_excluded(excluded):
    names = [r.name for r, _ in from_fixture(["vegan"])]
    assert excluded not in names


def test_way_elements_survive():
    """They were invisible under the old query."""
    assert "way" in [r.osmType for r, _ in from_fixture(["vegan"])]


def test_multi_need_filtering_intersects():
    names = sorted(r.name for r, _ in from_fixture(["vegan", "gluten-free"]))
    assert names == ["Askatu", "Mendocino Farms", "Voodoo Doughnut"]


def test_end_to_end_ordering_is_identical_across_runs():
    a = [(r.id, s.overall) for r, s in from_fixture(["vegan"])]
    b = [(r.id, s.overall) for r, s in from_fixture(["vegan"])]
    assert a == b


def test_recent_only_outranks_stale_yes():
    ranked = [r.name for r, _ in from_fixture(["vegan"])]
    assert ranked.index("Askatu") < ranked.index("Building-Mapped Vegan Kitchen")
