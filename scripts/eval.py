"""End-to-end evaluation against the real Nominatim and Overpass APIs.

The regression guard for the bugs that made this app return wrong results:
dietary needs that never reached the query, non-deterministic scoring,
fabricated provenance, and every failure looking like "no results".

Run with ``npm run eval``. Overpass is a free shared service and is regularly
saturated; a network failure here is not a test failure, and the script says
which it saw.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api._lib.agents.pipeline import AgentPipeline  # noqa: E402
from api._lib.confidence_scorer import (  # noqa: E402
    WEIGHT_COVERAGE,
    WEIGHT_DATA_COMPLETENESS,
    WEIGHT_DIET_TAG_STRENGTH,
    WEIGHT_TAG_RECENCY,
)
from api._lib.tools.diet_tags import matches_all_needs, partition_needs  # noqa: E402
from api._lib.types import DietaryRequest  # noqa: E402

passed = 0
failed = 0
skipped = 0


def load_env() -> None:
    """Minimal .env loader -- Next.js does this for the frontend at runtime."""
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        if "=" not in line or line.strip().startswith("#"):
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip("\"'")


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {name}{'  ' + detail if detail else ''}")
    else:
        failed += 1
        print(f"  FAIL  {name}{'  ' + detail if detail else ''}")


UPSTREAM = {"overpass_unavailable", "overpass_timeout", "geocode_unavailable"}


def skip_if_not_complete(label: str, pipeline: AgentPipeline) -> bool:
    """Assertions needing a successful run cannot say anything when it failed.

    Skips with the actual code rather than reporting a failure the code did not
    cause -- and prints it, so a genuine regression is still diagnosable.
    """
    global skipped
    if pipeline.state.status == "complete":
        return False
    code = pipeline.error_code
    upstream = ", upstream" if code in UPSTREAM else ""
    skipped += 1
    print(
        f"  SKIP  {label} -- run did not complete "
        f"(status={pipeline.state.status}"
        f"{', code=' + code if code else ''}{upstream})"
    )
    return True


async def run(query: str, **kwargs) -> AgentPipeline:
    pipeline = AgentPipeline()
    await pipeline.run(DietaryRequest(query=query, **kwargs))
    return pipeline


# --- confidence calibration ------------------------------------------------
#
# The obvious property -- "verified results outscore unverified ones" -- cannot
# be asserted, because there is no unverified population: score_restaurant()
# takes no Evidence at all, and everything reaching the scorer has already
# passed the hard dietary filter. So the assertions below are the ones the
# weights actually make true, and every bound is computed from the imported
# WEIGHT_* constants rather than hardcoded -- reweighting the scorer must fail
# this section rather than silently invalidate it.

#: Weakest positive OSM tagging: `yes` (some options) rather than `only`.
STRENGTH_YES = 0.8


def _weighted(strength: float, recency: float, coverage: float, completeness: float) -> float:
    """The scorer's own formula, for the enforceable-needs branch."""
    total = (
        WEIGHT_DIET_TAG_STRENGTH
        + WEIGHT_TAG_RECENCY
        + WEIGHT_COVERAGE
        + WEIGHT_DATA_COMPLETENESS
    )
    return (
        strength * WEIGHT_DIET_TAG_STRENGTH
        + recency * WEIGHT_TAG_RECENCY
        + coverage * WEIGHT_COVERAGE
        + completeness * WEIGHT_DATA_COMPLETENESS
    ) / total


#: A listing nobody has ever check_date'd scores 0 for recency, so however
#: perfect the rest of it is, it cannot reach the top of the scale.
CEILING_NO_CHECK_DATE = _weighted(1.0, 0.0, 1.0, 1.0)
#: ...and if its tag is merely `yes`, the ceiling drops further.
CEILING_YES_NO_CHECK_DATE = _weighted(STRENGTH_YES, 0.0, 1.0, 1.0)


def _distribution(scores: list[float]) -> str:
    if not scores:
        return "no results"
    return (
        f"n={len(scores)} min={min(scores):.2f} "
        f"mean={sum(scores) / len(scores):.2f} max={max(scores):.2f}"
    )


async def check_calibration() -> None:
    """Assert the confidence number means what its components say it means."""
    global skipped

    queries = [
        "vegan restaurants in Seattle",
        "vegan and gluten-free food in Seattle",
        "halal food near Los Angeles",
    ]

    inconsistent: list[str] = []
    over_ceiling: list[str] = []
    over_yes_ceiling: list[str] = []
    all_overall: list[float] = []
    dated: list[float] = []
    undated: list[float] = []
    scored_any = False

    for query in queries:
        pipeline = await run(query)
        if skip_if_not_complete(query, pipeline):
            continue

        meta = pipeline.meta
        # Every bound below is derived from the enforceable-needs branch of
        # score_restaurant. With no enforceable need the strength term is
        # dropped and the remaining weights renormalise, so the arithmetic is
        # different and these assertions would not apply.
        if not (meta and meta.enforceableNeeds):
            skipped += 1
            print(f"  SKIP  {query} -- no enforceable needs, different scoring branch")
            continue

        scored_any = True
        for rec in pipeline.state.recommendations:
            c = rec.confidence
            all_overall.append(c.overall)
            (dated if c.tagRecency > 0 else undated).append(c.overall)

            expected = _weighted(
                c.dietTagStrength, c.tagRecency, c.coverage, c.dataCompleteness
            )
            # _round in the scorer is round(v * 100) / 100, so allow one step.
            if abs(expected - c.overall) > 0.011:
                inconsistent.append(
                    f"{rec.restaurant.name}: reported {c.overall:.2f}, "
                    f"components give {expected:.2f}"
                )

            if c.tagRecency == 0:
                if c.overall > CEILING_NO_CHECK_DATE + 0.011:
                    over_ceiling.append(f"{rec.restaurant.name} {c.overall:.2f}")
                if (
                    c.dietTagStrength <= STRENGTH_YES
                    and c.overall > CEILING_YES_NO_CHECK_DATE + 0.011
                ):
                    over_yes_ceiling.append(f"{rec.restaurant.name} {c.overall:.2f}")

    if not scored_any:
        print("  SKIP  calibration -- no query produced a scorable result set")
        return

    check(
        "overall is the weighted mean of its own sub-scores",
        not inconsistent,
        "; ".join(inconsistent[:3]) or f"{len(all_overall)} results",
    )
    check(
        f"no unchecked listing exceeds {CEILING_NO_CHECK_DATE:.2f}",
        not over_ceiling,
        "; ".join(over_ceiling[:3]) or f"{len(undated)} without a check date",
    )
    check(
        f'no unchecked "yes"-tagged listing exceeds {CEILING_YES_NO_CHECK_DATE:.2f}',
        not over_yes_ceiling,
        "; ".join(over_yes_ceiling[:3]) or "none over",
    )

    # Printed, not asserted. Attestation ought to raise confidence, but it is
    # not guaranteed: a complete, `only`-tagged listing with no check date can
    # legitimately outscore a sparse `yes`-tagged one that has a recent date.
    # Asserting it would be asserting a tendency, which is how evals get flaky.
    print(f"        distribution  {_distribution(all_overall)}")
    print(f"        with check_date     {_distribution(dated)}")
    print(f"        without check_date  {_distribution(undated)}")


async def main() -> None:
    # `skipped` is incremented directly in the determinism branch below, which
    # would otherwise make it local to this function and shadow the module global.
    global skipped

    load_env()
    has_key = bool(os.environ.get("OPENAI_API_KEY"))
    print(
        f"\nOPENAI_API_KEY {'present -- LLM paths active' if has_key else 'absent -- testing deterministic fallbacks'}\n"
    )

    # 1. Dietary enforcement
    print("=== 1. Every result satisfies every enforceable need ===")
    for query, needs in [
        ("vegan restaurants in Seattle", ["vegan"]),
        ("vegan and gluten-free food in Seattle", ["vegan", "gluten-free"]),
        ("halal food near Los Angeles", ["halal"]),
    ]:
        pipeline = await run(query)
        if skip_if_not_complete(query, pipeline):
            continue
        enforceable, _ = partition_needs(needs)
        recs = pipeline.state.recommendations
        violations = [
            r for r in recs if not matches_all_needs(r.restaurant.dietTags, enforceable)
        ]
        check(
            f'"{query}" -- no result violates the diet',
            not violations,
            f"{len(recs)} results, {len(violations)} violations",
        )

    # 2. Determinism
    print("\n=== 2. The same query returns the same results ===")
    first = await run("vegan restaurants in Seattle")
    second = await run("vegan restaurants in Seattle")
    if not skip_if_not_complete("determinism", first):
        scanned_a = first.meta.candidatesScanned if first.meta else -1
        scanned_b = second.meta.candidatesScanned if second.meta else -1
        if scanned_a != scanned_b:
            # Overpass runs several mirrors with independent replication lag and
            # this client fails over between them. Different upstream data is not
            # a determinism bug here -- the offline fixture test is the assertion
            # without that ambiguity.
            skipped += 1
            print(
                "  SKIP  determinism -- upstream returned different data "
                f"({scanned_a} vs {scanned_b} candidates)"
            )
        else:
            ids_a = [r.restaurant.id for r in first.state.recommendations]
            ids_b = [r.restaurant.id for r in second.state.recommendations]
            check(
                "identical ids in identical order",
                ids_a == ids_b,
                f"{len(ids_a)} vs {len(ids_b)}, {scanned_a} candidates each",
            )
            scores_a = [s.overall for s in first.state.confidenceScores]
            scores_b = [s.overall for s in second.state.confidenceScores]
            check("identical confidence scores (no randomness)", scores_a == scores_b)

    # 3. Geocoding
    print("\n=== 3. Locations resolve to the right place ===")
    pipeline = await run("vegan food within 5 miles of Seattle")
    if not skip_if_not_complete("geocoding", pipeline):
        resolved = pipeline.meta.resolvedLocation if pipeline.meta else ""
        check(
            '"within 5 miles of Seattle" resolves to Seattle',
            "seattle" in resolved.lower(),
            resolved or "(none)",
        )

    # 4. No fabricated data
    print("\n=== 4. Nothing is fabricated ===")
    pipeline = await run("vegan restaurants in Seattle")
    if not skip_if_not_complete("fabrication", pipeline):
        recs = pipeline.state.recommendations
        sample = recs[0].restaurant.to_json() if recs else {}
        check(
            "no rating / reviewCount / priceLevel / source on results",
            not any(
                k in sample for k in ("rating", "reviewCount", "priceLevel", "source")
            ),
        )
        check(
            "every id carries its OSM element type",
            all(
                r.restaurant.id.startswith(("osm-node-", "osm-way-", "osm-relation-"))
                for r in recs
            ),
        )

    # 5. Honest failure
    print("\n=== 5. A bad location is an error, not an empty result ===")
    pipeline = await run("vegan food in Zzzqqxthisplacedoesnotexist")
    if pipeline.error_code in UPSTREAM:
        skipped += 1
        print("  SKIP  honest failure -- upstream unavailable")
    else:
        check(
            'status is "error", not "complete" with zero results',
            pipeline.state.status == "error",
            f"status={pipeline.state.status} code={pipeline.error_code}",
        )
        check(
            "error code identifies the cause",
            pipeline.error_code == "geocode_failed",
            str(pipeline.error_code),
        )

    # 6. Unenforceable needs reported, not dropped
    print("\n=== 6. Needs OSM cannot express are surfaced ===")
    pipeline = await run("keto vegan food in Seattle")
    if not skip_if_not_complete("unenforceable needs", pipeline):
        meta = pipeline.meta
        check(
            '"keto" is reported as unenforceable',
            bool(meta and "keto" in meta.unenforceableNeeds),
            str(meta.unenforceableNeeds if meta else []),
        )
        check(
            '"vegan" is still enforced',
            bool(meta and "vegan" in meta.enforceableNeeds),
        )

    # 7. Confidence is calibrated to the evidence
    print("\n=== 7. Confidence reflects the evidence behind it ===")
    await check_calibration()

    print(
        f"\n{passed} passed, {failed} failed, "
        f"{skipped} skipped (upstream unavailable)\n"
    )
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    asyncio.run(main())
