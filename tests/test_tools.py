"""Tests for the pure functions that decide dietary safety and ranking.

These are the functions worth testing above all others: everything else in the
pipeline is presentation or I/O, but a bug here shows someone a restaurant that
does not meet their dietary requirement.

Ported 1:1 from the TypeScript suite so parity is checkable assertion by
assertion. Run with ``pytest``.
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api._lib.agents import discovery  # noqa: E402
from api._lib.agents.discovery import RestaurantDiscoveryAgent  # noqa: E402
from api._lib.confidence_scorer import (  # noqa: E402
    completeness_score,
    recency_score,
    score_restaurant,
)
from api._lib.errors import DiscoveryError  # noqa: E402
from api._lib.tools import overpass  # noqa: E402
from api._lib.tools.geocode import GeocodeResult  # noqa: E402
from api._lib.tools.diet_tags import (  # noqa: E402
    cuisine_filter,
    cuisine_matches,
    diet_tag_strength,
    is_known_need,
    matches_all_needs,
    partition_needs,
)
from api._lib.tools.overpass import (  # noqa: E402
    OverpassPlace,
    build_overpass_query,
    diet_filter_combinations,
)
from api._lib.types import Coordinates, ParsedIntent, Restaurant  # noqa: E402

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


# --- Radius ladder resilience --------------------------------------------
#
# Overpass saturates per-query, so one rung failing says nothing about the next.
# These pin the three outcomes apart: widen past a failure, degrade to a partial
# answer, and refuse to report an outage as an empty result set.


def ladder_run(rungs, on_rung=None):
    """Drives the ladder with ``rungs`` mapping radius -> places or an error."""
    agent = RestaurantDiscoveryAgent()
    intent = ParsedIntent(
        dietaryNeeds=["halal"],
        restrictions=[],
        location="Santa Monica",
        isLocationAmbiguous=False,
        cuisineType="burger",
    )
    geocoded = GeocodeResult(lat=34.0, lng=-118.5, displayName="Santa Monica")
    calls: list[int] = []

    async def fake_search(*, lat, lng, radius_m, diet_needs, cuisine_type):
        calls.append(radius_m)
        if on_rung is not None:
            on_rung(radius_m)
        outcome = rungs[radius_m]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    with mock.patch.object(discovery, "search_restaurants", fake_search):
        places, searched = asyncio.run(
            agent._search_with_ladder(intent, geocoded, ["halal"])
        )
    return places, searched, calls


def halal_place(osm_id: int) -> OverpassPlace:
    return OverpassPlace(
        osmType="node",
        osmId=osm_id,
        lat=34.0,
        lng=-118.5,
        tags={"name": f"Halal {osm_id}", "diet:halal": "yes"},
    )


def test_failed_rung_does_not_end_the_search():
    """One match at 2km, both mirrors 504 at 5km, 5 results at 10km."""
    timeout = DiscoveryError("overpass_timeout", "Overpass timed out after 25s")
    places, searched, calls = ladder_run(
        {
            2000: [halal_place(9)],
            5000: timeout,
            10_000: [halal_place(i) for i in range(5)],
            25_000: [],
        }
    )
    assert [p.osmId for p in places] == [0, 1, 2, 3, 4]
    assert searched == 10_000
    assert calls == [2000, 5000, 10_000]


def test_a_lost_rung_walks_rather_than_skipping():
    """A lost rung carries no information, so spend the budget on more chances."""
    timeout = DiscoveryError("overpass_timeout", "Overpass timed out after 11s")
    _, _, calls = ladder_run(
        {2000: timeout, 5000: [halal_place(i) for i in range(3)], 10_000: [], 25_000: []}
    )
    assert calls == [2000, 5000]


def test_partial_results_survive_a_later_failure():
    """Enough at 2km but under MIN_RESULTS, then an outage: show what we have."""
    places, searched, _ = ladder_run(
        {
            2000: [halal_place(1)],
            5000: DiscoveryError("overpass_unavailable", "Overpass returned 504"),
            10_000: DiscoveryError("overpass_unavailable", "Overpass returned 504"),
            25_000: DiscoveryError("overpass_unavailable", "Overpass returned 504"),
        }
    )
    assert [p.osmId for p in places] == [1]
    assert searched == 2000


def test_outage_with_nothing_to_show_is_not_reported_as_empty():
    """A search that never completed must not read as an established absence."""
    with pytest.raises(DiscoveryError) as caught:
        ladder_run(
            {
                2000: [],
                5000: DiscoveryError("overpass_timeout", "timed out"),
                10_000: DiscoveryError("overpass_timeout", "timed out"),
                25_000: DiscoveryError("overpass_timeout", "timed out"),
            }
        )
    assert caught.value.code == "overpass_timeout"


def test_genuinely_empty_search_still_reports_empty():
    """Every rung answered and none matched -- that is a real zero, not an error."""
    places, searched, calls = ladder_run(
        {2000: [], 5000: [], 10_000: [], 25_000: []}
    )
    assert places == []
    assert searched == 25_000


def test_a_barren_rung_skips_straight_to_the_widest():
    """The reported hang: halal+gluten-free has no match at any radius.

    Four rungs at a wide-radius timeout each cannot fit the function limit, so
    the intermediate ones -- which cannot settle a question the widest answers
    outright -- are skipped.
    """
    _, searched, calls = ladder_run({2000: [], 5000: [], 10_000: [], 25_000: []})
    assert calls == [2000, 25_000]
    assert searched == 25_000


def test_a_rung_with_some_matches_still_widens_one_step():
    """Only a *barren* rung justifies the jump; a thin one may fill in next rung."""
    _, _, calls = ladder_run(
        {
            2000: [halal_place(1)],
            5000: [halal_place(i) for i in range(3)],
            10_000: [],
            25_000: [],
        }
    )
    assert calls == [2000, 5000]


def test_a_truncated_jump_resumes_the_normal_walk():
    """At the element cap "nearest" is unreadable, so the skipped rungs are run."""
    capped = [halal_place(i) for i in range(overpass.MAX_ELEMENTS)]
    _, searched, calls = ladder_run(
        {
            2000: [],
            5000: [halal_place(i) for i in range(3)],
            10_000: [],
            25_000: capped,
        }
    )
    assert calls == [2000, 25_000, 5000]
    assert searched == 5000


def test_ladder_stops_when_the_time_budget_is_spent():
    """Four rungs x one timeout each would otherwise outlive the function limit."""
    elapsed = 0.0

    def spend(_radius):
        # Each rung burns most of the budget, so the third cannot start.
        nonlocal elapsed
        elapsed += discovery.SEARCH_BUDGET_S * 0.6

    # Only the name `time` inside discovery is swapped -- patching the real
    # time.monotonic would also drive asyncio's event loop clock.
    clock = mock.Mock(monotonic=lambda: elapsed)
    with mock.patch.object(discovery, "time", clock):
        places, _, calls = ladder_run(
            {2000: [halal_place(2)], 5000: [halal_place(1)], 10_000: [], 25_000: []},
            on_rung=spend,
        )
    assert calls == [2000, 5000]
    assert [p.osmId for p in places] == [1]


# --- Overpass mirror racing ----------------------------------------------


def test_healthy_first_mirror_is_not_hedged():
    """The common case must cost one request -- hedging every call invites 429s."""
    tried: list[str] = []

    async def fetch(url, query, timeout_s):
        tried.append(url)
        return {"elements": [{"id": 1}]}

    with mock.patch.object(overpass, "_fetch_overpass", fetch):
        payload = asyncio.run(overpass._fetch_with_mirrors("q", 10.0))
    assert payload["elements"] == [{"id": 1}]
    assert tried == [overpass.OVERPASS_MIRRORS[0]]


def test_a_fast_failure_brings_the_next_mirror_up_immediately():
    """A 504 must not cost the hedge delay before failing over."""
    tried: list[str] = []

    async def fetch(url, query, timeout_s):
        tried.append(url)
        if url == overpass.OVERPASS_MIRRORS[0]:
            raise DiscoveryError("overpass_unavailable", "Overpass returned 504")
        return {"elements": [{"id": 7}]}

    with mock.patch.object(overpass, "_fetch_overpass", fetch):
        with mock.patch.object(overpass, "HEDGE_DELAY_S", 30.0):
            payload = asyncio.run(overpass._fetch_with_mirrors("q", 10.0))
    assert payload["elements"] == [{"id": 7}]
    assert tried == list(overpass.OVERPASS_MIRRORS)


def test_a_stalled_mirror_is_hedged_and_the_loser_is_cancelled():
    started: list[str] = []
    cancelled = False

    async def fetch(url, query, timeout_s):
        nonlocal cancelled
        started.append(url)
        if url == overpass.OVERPASS_MIRRORS[0]:
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled = True
                raise
        return {"elements": [{"id": 9}]}

    with mock.patch.object(overpass, "_fetch_overpass", fetch):
        with mock.patch.object(overpass, "HEDGE_DELAY_S", 0.05):
            payload = asyncio.run(overpass._fetch_with_mirrors("q", 10.0))
    assert payload["elements"] == [{"id": 9}]
    assert started == list(overpass.OVERPASS_MIRRORS)
    assert cancelled


def test_raises_only_when_every_mirror_fails():
    async def fetch(url, query, timeout_s):
        raise DiscoveryError("overpass_timeout", "Overpass timed out after 25s")

    with mock.patch.object(overpass, "_fetch_overpass", fetch):
        with pytest.raises(DiscoveryError) as caught:
            asyncio.run(overpass._fetch_with_mirrors("q", 10.0))
    assert caught.value.code == "overpass_timeout"


# --- Radius-scaled timeouts ----------------------------------------------


def test_timeout_grows_with_radius():
    """A flat budget could not express "nothing within 25km": that query needs ~14s."""
    assert overpass.timeout_for_radius(2000) < overpass.timeout_for_radius(25_000)
    assert overpass.timeout_for_radius(25_000) >= 14.0


def test_timeout_is_capped():
    assert overpass.timeout_for_radius(10**9) == overpass.MAX_TIMEOUT_S


def test_server_timeout_matches_the_client_deadline():
    """A server timeout longer than the client's just wastes the work."""
    query = build_overpass_query(34.0, -118.5, 25_000, ["halal"])
    expected = round(overpass.timeout_for_radius(25_000))
    assert f"[out:json][timeout:{expected}]" in query
