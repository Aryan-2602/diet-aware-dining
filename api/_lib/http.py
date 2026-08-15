"""FastAPI application serving the recommendation API.

Lives under `_lib` so Vercel does not route to it directly. The thin files in
`api/` (recommend.py, clarify.py, health.py) each re-export this `app`, so every
function's file path matches the URL it serves — no rewrite, and therefore no
mismatch between the path Vercel delivers and the path FastAPI declares.

The JSON contract is unchanged from the TypeScript routes it replaced, so the
React frontend needs no edits.

A pipeline run has four distinct outcomes and they must not collapse into one.
The original TypeScript route only checked for ``awaiting_clarification``; a
geocode miss, an Overpass outage, a rate limit and a genuinely empty result set
all returned HTTP 200 with ``status: "complete"`` and zero recommendations, so
the UI rendered "No restaurants found" for every one of them.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .agents.pipeline import AgentPipeline
from .request_context import get_request_id, new_request_id, set_request_id
from .types import DietaryRequest, parsed_intent_to_json

LOG_FORMAT = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"


class _RequestIdFormatter(logging.Formatter):
    """Stamps every record with the current request id.

    A Formatter rather than a Filter: a format string containing
    ``%(request_id)s`` raises on any record that lacks the attribute, and plenty
    of records come from libraries that know nothing about it -- httpx, uvicorn,
    asyncio. Supplying the default here makes that impossible rather than
    relying on a filter being attached to every handler that might see one.
    """

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id()
        return super().format(record)


def _configure_logging() -> None:
    """Install the correlating formatter on whatever handlers exist.

    Deliberately not ``basicConfig(format=...)``: basicConfig is a no-op once the
    root logger has handlers, which is exactly the case under uvicorn -- so the
    format would silently not apply in the environment that matters. ``force=True``
    would work but tears down uvicorn's own handlers with it.
    """
    logging.basicConfig(level=logging.INFO)
    root = logging.getLogger()
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    for handler in root.handlers:
        handler.setFormatter(_RequestIdFormatter(LOG_FORMAT))


_configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="Diet Aware Dining API", docs_url=None, redoc_url=None)

#: Upstream service problems the user can only wait out.
UPSTREAM_CODES = {
    "geocode_unavailable",
    "overpass_unavailable",
    "overpass_timeout",
}


class RecommendBody(BaseModel):
    query: str = ""
    location: str = ""
    # Defaults rather than required fields: a non-list value used to reach
    # spread syntax in the TypeScript version and throw a 500.
    dietaryPreferences: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    cuisinePreferences: list[str] = Field(default_factory=list)


class ClarifyBody(BaseModel):
    originalRequest: Optional[RecommendBody] = None
    answers: Optional[dict[str, str]] = None


def _instrumentation(pipeline: AgentPipeline) -> dict[str, Any]:
    """Per-request instrumentation, emitted on every branch.

    Included on the failure and empty branches too, not just "complete" -- a
    search that times out after 40s is precisely the one whose stage breakdown
    you want, and that branch carries no metadata at all otherwise.
    """
    return {
        "stageTimingsMs": pipeline.state.stageTimingsMs,
        "usedLLM": pipeline.state.usedLLM,
    }


def _respond(pipeline: AgentPipeline) -> JSONResponse:
    state = pipeline.state
    meta = pipeline.meta.to_json() if pipeline.meta else None
    instrumentation = _instrumentation(pipeline)

    if state.status == "awaiting_clarification":
        return JSONResponse(
            {
                "status": "awaiting_clarification",
                "clarificationNeeded": [
                    q.to_json() for q in (state.clarificationNeeded or [])
                ],
                "parsedIntent": parsed_intent_to_json(state.parsedIntent),
                "metadata": instrumentation,
            }
        )

    if state.status == "error":
        code = pipeline.error_code or "internal"
        status = 422 if code == "geocode_failed" else 503 if code in UPSTREAM_CODES else 500
        return JSONResponse(
            {
                "status": "error",
                "code": code,
                "message": state.error or "Something went wrong",
                "parsedIntent": parsed_intent_to_json(state.parsedIntent),
                "metadata": instrumentation,
            },
            status_code=status,
        )

    # A real, honest zero: the search ran and nothing satisfied the requirement.
    if not state.recommendations:
        return JSONResponse(
            {
                "status": "no_matches",
                "recommendations": [],
                "parsedIntent": parsed_intent_to_json(state.parsedIntent),
                "meta": meta,
                "metadata": instrumentation,
            }
        )

    scores = state.confidenceScores
    avg = (
        round(sum(s.overall for s in scores) / len(scores) * 100) / 100
        if scores
        else 0
    )

    return JSONResponse(
        {
            "status": "complete",
            "recommendations": [r.to_json() for r in state.recommendations],
            "parsedIntent": parsed_intent_to_json(state.parsedIntent),
            "mapData": state.mapData.to_json() if state.mapData else None,
            "meta": meta,
            "metadata": {
                # Counts describe the set actually shown, rather than mixing in
                # candidates discarded before display.
                "totalFound": len(state.recommendations),
                "candidatesScanned": (meta or {}).get("candidatesScanned", 0),
                "verified": len([e for e in state.evidence if e.verified]),
                "avgConfidence": avg,
                **instrumentation,
            },
        }
    )


def _to_request(body: RecommendBody) -> DietaryRequest:
    return DietaryRequest(
        query=body.query,
        location=body.location or "",
        dietaryPreferences=list(body.dietaryPreferences or []),
        allergies=list(body.allergies or []),
        cuisinePreferences=list(body.cuisinePreferences or []),
    )


@app.post("/api/recommend")
async def recommend(body: RecommendBody) -> Any:
    if not body.query.strip():
        return JSONResponse(
            {
                "status": "error",
                "code": "bad_request",
                "message": "Query is required",
            },
            status_code=400,
        )

    set_request_id(new_request_id())
    logger.info(
        "POST /api/recommend query_len=%d location=%r needs=%s",
        len(body.query),
        body.location,
        body.dietaryPreferences,
    )

    pipeline = AgentPipeline()
    await pipeline.run(_to_request(body))
    return _respond(pipeline)


@app.post("/api/clarify")
async def clarify(body: ClarifyBody) -> Any:
    if body.originalRequest is None or body.answers is None:
        return JSONResponse(
            {
                "status": "error",
                "code": "bad_request",
                "message": "originalRequest and answers are required",
            },
            status_code=400,
        )

    set_request_id(new_request_id())
    logger.info("POST /api/clarify answered=%s", sorted(body.answers.keys()))

    answers = body.answers
    original = _to_request(body.originalRequest)

    # Every answer is merged, not just the location. The clarification agent
    # asks about dietary needs too and the dialog lets the user answer -- those
    # answers used to be dropped, so the re-run was byte-identical to the
    # request that had just asked for them.
    clarified = DietaryRequest(
        query=original.query,
        location=(answers.get("location") or "").strip() or original.location,
        dietaryPreferences=[
            *original.dietaryPreferences,
            *([answers["dietaryNeeds"]] if answers.get("dietaryNeeds") else []),
        ],
        allergies=original.allergies,
        cuisinePreferences=original.cuisinePreferences,
    )

    pipeline = AgentPipeline()
    await pipeline.run(clarified)
    # Shares the responder with /recommend, so a still-ambiguous location comes
    # back as another question instead of a false "complete" with zero results.
    return _respond(pipeline)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
