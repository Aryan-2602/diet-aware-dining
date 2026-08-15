"""Agent Pipeline Orchestrator.

Dietary Intent -> [Clarification?] -> Restaurant Discovery ->
(Evidence || Confidence scoring) -> Map -> Recommendation -> Export

Four of these are LLM agents that reason about the request; the rest are
deterministic services, named as such. Discovery relaxes its own radius
internally, so there is no separate "too few results" stage.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator, Literal, Optional

from ..confidence_scorer import score_restaurants
from ..errors import DiscoveryError
from ..services.export_service import ExportFormat, ExportResult, ExportService
from ..services.map_service import MapService
from ..tools.diet_tags import is_known_need
from ..types import (
    ClarificationQuestion,
    ConfidenceScore,
    DietaryRequest,
    Evidence,
    MapData,
    ParsedIntent,
    PipelineMeta,
    Recommendation,
    Restaurant,
)
from .clarification import ClarificationAgent
from .dietary_intent import DietaryIntentAgent
from .discovery import RestaurantDiscoveryAgent
from .evidence_verification import EvidenceVerificationAgent
from .recommendation import RecommendationAgent

logger = logging.getLogger(__name__)

PipelineStatus = Literal[
    "idle", "processing", "awaiting_clarification", "complete", "error"
]


@dataclass
class PipelineState:
    status: PipelineStatus = "idle"
    currentAgent: Optional[str] = None
    request: Optional[DietaryRequest] = None
    parsedIntent: Optional[ParsedIntent] = None
    clarificationNeeded: Optional[list[ClarificationQuestion]] = None
    restaurants: list[Restaurant] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    confidenceScores: list[ConfidenceScore] = field(default_factory=list)
    recommendations: list[Recommendation] = field(default_factory=list)
    mapData: Optional[MapData] = None
    exportResult: Optional[ExportResult] = None
    error: Optional[str] = None
    #: Wall-clock per stage, in milliseconds. Recorded even when a stage
    #: raises -- a slow failure is the case most worth measuring.
    stageTimingsMs: dict[str, float] = field(default_factory=dict)
    #: Whether intent extraction used the LLM or the deterministic fallback.
    #: None until the intent stage has run.
    usedLLM: Optional[bool] = None


class AgentPipeline:
    """Coordinates one search from DietaryRequest to ranked recommendations."""

    def __init__(self) -> None:
        self._intent_agent = DietaryIntentAgent()
        self._clarification_agent = ClarificationAgent()
        self._discovery_agent = RestaurantDiscoveryAgent()
        self._evidence_agent = EvidenceVerificationAgent()
        self._recommendation_agent = RecommendationAgent()
        self._map_service = MapService()
        self._export_service = ExportService()

        self.state = PipelineState()
        self.meta: Optional[PipelineMeta] = None
        #: Set when the failure was an upstream service rather than a bad request.
        self.error_code: Optional[str] = None

    @contextmanager
    def _timed(self, stage: str) -> Iterator[None]:
        """Records how long a stage took, and logs it.

        try/finally rather than a plain before/after pair so the timing survives
        an exception -- the slow failures are exactly the ones worth measuring,
        and ``resume_with_clarification`` has no try/except of its own, so a
        DiscoveryError propagates straight out of it.

        The stage is re-raised untouched; this observes, it does not handle.
        """
        start = time.perf_counter()
        status = "ok"
        try:
            yield
        except BaseException:
            status = "error"
            raise
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            self.state.stageTimingsMs[stage] = round(elapsed_ms, 1)
            logger.info(
                "stage=%s status=%s elapsed_ms=%.1f", stage, status, elapsed_ms
            )

    async def run(self, request: DietaryRequest) -> list[Recommendation]:
        """Run the pipeline from scratch.

        HTTP ``/api/clarify`` also calls this, not ``resume_with_clarification``:
        each request is a new process, so there is no in-memory pipeline to resume.
        """
        try:
            self.state.status = "processing"
            self.state.request = request
            self.state.error = None

            self.state.currentAgent = "dietary_intent"
            with self._timed("dietary_intent"):
                intent = await self._intent_agent.process(request)
            # Which extraction path ran is only knowable from the agent; the
            # ParsedIntent it returns is shape-identical either way.
            self.state.usedLLM = self._intent_agent.used_llm
            self.state.parsedIntent = intent

            # A missing location is as blocking as an ambiguous one -- without
            # it there is nothing to geocode.
            if intent.isLocationAmbiguous or not intent.location.strip():
                self.state.currentAgent = "clarification"
                with self._timed("clarification"):
                    questions = await self._clarification_agent.process(intent)
                if questions:
                    self.state.status = "awaiting_clarification"
                    self.state.clarificationNeeded = questions
                    return []

            return await self._continue_after_clarification()
        except DiscoveryError as error:
            # Errors carry a machine-readable code so the API layer can
            # distinguish "your location does not exist" from "OpenStreetMap is
            # down" from "nothing matched". Previously all three returned an
            # empty list and were reported as "no restaurants found".
            self.error_code = error.code
            self.state.status = "error"
            self.state.error = error.message
            return []
        except Exception as error:  # noqa: BLE001 - recorded, not swallowed
            self.error_code = "internal"
            self.state.status = "error"
            self.state.error = str(error) or "Pipeline error"
            return []

    async def resume_with_clarification(
        self, answers: dict[str, str]
    ) -> list[Recommendation]:
        """Apply clarification answers onto the in-memory intent and continue.

        Kept for tests and a possible future sessionful runtime. The FastAPI
        route rebuilds a DietaryRequest and calls ``run`` instead.
        """
        if self.state.parsedIntent is None:
            raise RuntimeError("No pending intent to clarify")

        intent = self.state.parsedIntent
        if answers.get("location"):
            intent = self._clarification_agent.resolve_location(
                intent, answers["location"]
            )

        # Clarification answers are user input and get the same vocabulary check
        # as everything else. The dietary question used to offer "No specific
        # requirements", which was pushed in verbatim as a dietary need.
        answer = (answers.get("dietaryNeeds") or "").strip().lower()
        if answer and is_known_need(answer) and answer not in intent.dietaryNeeds:
            intent.dietaryNeeds = [*intent.dietaryNeeds, answer]

        self.state.parsedIntent = intent
        self.state.clarificationNeeded = None
        self.state.status = "processing"
        return await self._continue_after_clarification()

    async def _continue_after_clarification(self) -> list[Recommendation]:
        """Discovery through export, once a geocodable location exists."""
        intent = self.state.parsedIntent
        assert intent is not None

        # Discovery raises a typed DiscoveryError rather than returning [] when
        # geocoding or Overpass fails.
        self.state.currentAgent = "restaurant_discovery"
        with self._timed("restaurant_discovery"):
            discovery = await self._discovery_agent.process(intent)
        restaurants = discovery.restaurants
        enforceable = discovery.enforceableNeeds
        unenforceable = discovery.unenforceableNeeds
        self.state.restaurants = restaurants

        self.meta = PipelineMeta(
            enforceableNeeds=enforceable,
            unenforceableNeeds=unenforceable,
            effectiveRadiusM=discovery.effectiveRadiusM,
            radiusSearchedM=discovery.radiusSearchedM,
            candidatesScanned=discovery.candidatesScanned,
            resolvedLocation=discovery.geocoded.displayName,
        )

        # Evidence and scoring are independent, so they run concurrently.
        self.state.currentAgent = "evidence_verification"
        # Timed as one bucket, not two: these overlap, so separate figures would
        # sum to more than the wall-clock they actually cost.
        with self._timed("evidence_verification"):
            evidence, scores = await asyncio.gather(
                self._evidence_agent.process(
                    restaurants, intent, enforceable, unenforceable
                ),
                _as_coroutine(
                    score_restaurants(restaurants, enforceable, intent.dietaryNeeds)
                ),
            )
        self.state.evidence = evidence
        self.state.confidenceScores = scores

        # There is deliberately no confidence-threshold filter. The hard dietary
        # filter is the safety gate; dropping *verified* matches for scoring
        # below an arbitrary 0.5 removed correct results silently.

        self.state.currentAgent = "map_generation"
        confidence_map = {s.restaurantId: s.overall for s in scores}
        with self._timed("map_generation"):
            self.state.mapData = await self._map_service.process(
                restaurants, confidence_map
            )

        self.state.currentAgent = "recommendation"
        with self._timed("recommendation"):
            recommendations = await self._recommendation_agent.process(
                restaurants, scores, evidence, intent, enforceable, unenforceable
            )

        self.state.currentAgent = "export"
        with self._timed("export"):
            self.state.exportResult = await self._export_service.process(
                recommendations, "json"
            )

        self.state.recommendations = recommendations
        self.state.status = "complete"
        self.state.currentAgent = None
        return recommendations

    async def export(self, fmt: ExportFormat) -> ExportResult:
        """Re-export the last recommendations in a different format."""
        return await self._export_service.process(self.state.recommendations, fmt)


async def _as_coroutine(value: Any) -> Any:
    """Lets a synchronous result participate in asyncio.gather."""
    return value
