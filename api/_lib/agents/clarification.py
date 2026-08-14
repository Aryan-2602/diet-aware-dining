"""Clarification Agent.

Asks the user for what is genuinely missing, in wording that reflects their
actual query. The original version emitted three fixed templates and asked about
meal type on nearly every search -- a question whose answer nothing in the
pipeline could act on.

It only asks about things that change the outcome. Meal type is no longer asked
at all: OSM ``opening_hours`` parsing is not implemented, so the answer would be
collected and ignored.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..errors import LLMUnavailableError
from ..llm_client import call_llm, parse_json_response
from ..tools.diet_tags import DIETARY_VOCABULARY
from ..types import ClarificationQuestion, ParsedIntent

logger = logging.getLogger(__name__)


class ClarificationAgent:
    async def process(self, intent: ParsedIntent) -> list[ClarificationQuestion]:
        gaps = self._find_gaps(intent)
        if not gaps:
            return []
        try:
            return await self._write_questions(intent, gaps)
        except LLMUnavailableError as error:
            logger.warning(
                "[ClarificationAgent] question generation unavailable, using "
                "templates: %s",
                error,
            )
            return self._template_questions(intent, gaps)

    def resolve_location(
        self, intent: ParsedIntent, clarified_location: str
    ) -> ParsedIntent:
        return ParsedIntent(
            dietaryNeeds=intent.dietaryNeeds,
            restrictions=intent.restrictions,
            location=clarified_location,
            isLocationAmbiguous=False,
            cuisineType=intent.cuisineType,
            mealType=intent.mealType,
            priceRange=intent.priceRange,
        )

    def _find_gaps(self, intent: ParsedIntent) -> list[str]:
        """Only gaps that would actually change the search."""
        gaps: list[str] = []
        if intent.isLocationAmbiguous or not intent.location.strip():
            gaps.append("location")
        if not intent.dietaryNeeds:
            gaps.append("dietaryNeeds")
        return gaps

    async def _write_questions(
        self, intent: ParsedIntent, gaps: list[str]
    ) -> list[ClarificationQuestion]:
        system = "\n".join(
            [
                "You write clarifying questions for a restaurant search.",
                'Return ONLY JSON: { "questions": [{ "field": string, '
                '"question": string, "options": string[] | null }] }',
                "",
                "Rules:",
                f"- One question per requested field, in order. Fields: {json.dumps(gaps)}.",
                "- Reference what the user actually said. Be specific about why you are",
                "  asking -- a vague location needs a city or postcode, for example.",
                "- One sentence each. Friendly, not chatty.",
                '- For "dietaryNeeds", options MUST come from this list: '
                f"{json.dumps(list(DIETARY_VOCABULARY))}. Do not add a 'none' option.",
                '- For "location", options must be null -- it is free text.',
            ]
        )
        user = "\n".join(
            [
                f"Location understood as: {intent.location or '(nothing given)'}",
                f"Flagged ambiguous: {intent.isLocationAmbiguous}",
                f"Dietary needs detected: {', '.join(intent.dietaryNeeds) or 'none'}",
                f"Cuisine: {intent.cuisineType or 'none'}",
            ]
        )

        raw = await call_llm(system=system, user=user, max_tokens=400, json_mode=True)
        try:
            parsed: dict[str, Any] = parse_json_response(raw)
        except ValueError as error:
            raise LLMUnavailableError(str(error)) from None

        questions = parsed.get("questions")
        validated: list[ClarificationQuestion] = []
        if isinstance(questions, list):
            for item in questions:
                if not isinstance(item, dict):
                    continue
                field = item.get("field")
                question = item.get("question")
                if field not in gaps or not isinstance(question, str):
                    continue
                if not question.strip():
                    continue
                # Options are re-derived from the vocabulary rather than
                # trusted, so the model cannot introduce a choice the filter has
                # no mapping for.
                validated.append(
                    ClarificationQuestion(
                        field_=field,
                        question=question.strip(),
                        options=list(DIETARY_VOCABULARY)
                        if field == "dietaryNeeds"
                        else None,
                    )
                )

        # A partial answer falls back rather than dropping a needed question.
        if len(validated) == len(gaps):
            return validated
        return self._template_questions(intent, gaps)

    def _template_questions(
        self, intent: ParsedIntent, gaps: list[str]
    ) -> list[ClarificationQuestion]:
        out: list[ClarificationQuestion] = []
        for gap in gaps:
            if gap == "location":
                out.append(
                    ClarificationQuestion(
                        field_="location",
                        question=(
                            f'"{intent.location}" could be a few different places '
                            "-- which city or postcode?"
                            if intent.location
                            else "Which city or neighbourhood should we search?"
                        ),
                        options=None,
                    )
                )
            else:
                out.append(
                    ClarificationQuestion(
                        field_="dietaryNeeds",
                        question="Which dietary requirement should we verify?",
                        options=list(DIETARY_VOCABULARY),
                    )
                )
        return out
