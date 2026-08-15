"""Dietary Intent Agent.

First agent in the pipeline. Parses a free-text dietary request into structured
intent. Extraction is LLM-based; if the LLM is unavailable -- no API key,
network failure, timeout, unparseable output -- it falls back to the original
deterministic keyword/regex parser so the request still completes.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from ..errors import LLMUnavailableError
from ..llm_client import call_llm, parse_json_response
from ..tools.diet_tags import DIETARY_VOCABULARY
from ..types import DietaryRequest, ParsedIntent

logger = logging.getLogger(__name__)

DIETARY_KEYWORDS: dict[str, list[str]] = {
    "vegan": ["vegan", "plant-based", "no animal"],
    "vegetarian": ["vegetarian", "veggie", "no meat"],
    "gluten-free": ["gluten-free", "gluten free", "celiac", "no gluten"],
    "dairy-free": ["dairy-free", "dairy free", "lactose", "no dairy"],
    "keto": ["keto", "ketogenic", "low-carb", "low carb"],
    "halal": ["halal"],
    "kosher": ["kosher"],
    "paleo": ["paleo", "paleolithic"],
    "nut-free": ["nut-free", "nut free", "no nuts", "peanut-free"],
}

CUISINE_KEYWORDS = [
    "italian",
    "mexican",
    "chinese",
    "japanese",
    "indian",
    "thai",
    "korean",
    "mediterranean",
    "american",
    "french",
    "vietnamese",
    "greek",
    "middle eastern",
    "ethiopian",
    "caribbean",
]

MEAL_TYPES = ["breakfast", "brunch", "lunch", "dinner", "late-night", "snack"]

PRICE_RANGES = ("budget", "moderate", "premium", "any")

AMBIGUOUS_TERMS = ["downtown", "near me", "nearby", "around here", "close"]

# The leading \b matters: without it, "within 5 miles of Seattle" matches the
# "in" inside "within" and yields the location "5 miles of seattle", which
# geocodes to nothing. The distance form is tried first so it wins over the
# bare preposition. The trailing punctuation class matters too: without it,
# "in Santa Monica, gluten-free buns available" yields the whole tail.
LOCATION_PATTERNS = [
    re.compile(
        r"\bwithin\s+[\d.]+\s*(?:mi|miles?|km|kilometers?|blocks?)\s+of\s+"
        r"(.+?)(?:\s+that\b|\s+with\b|\s+for\b|\s+open\b|[,.;]|$)",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:in|near|around|nearby|close to)\s+"
        r"(.+?)(?:\s+that\b|\s+with\b|\s+for\b|\s+open\b|[,.;]|$)",
        re.IGNORECASE,
    ),
]


class DietaryIntentAgent:
    def __init__(self) -> None:
        #: Which path served the most recent process() call. Instance state is
        #: safe because http.py builds a fresh AgentPipeline -- and so a fresh
        #: agent -- per request, so there is nothing to leak between them.
        #: None until process() has run.
        self.used_llm: Optional[bool] = None

    async def process(self, request: DietaryRequest) -> ParsedIntent:
        """Parse free text into ParsedIntent; keyword/regex fallback if the LLM is down."""
        try:
            intent = await self._process_with_llm(request)
        except LLMUnavailableError as error:
            # Previously this was the only trace that the fallback had run: the
            # ParsedIntent it returns is shape-identical to the LLM's, so a
            # response gave no indication which produced it.
            self.used_llm = False
            logger.warning(
                "[DietaryIntentAgent] LLM extraction unavailable, falling back "
                "to rule-based parser: %s",
                error,
            )
            return self._process_with_rules(request)

        self.used_llm = True
        logger.info("[DietaryIntentAgent] intent extracted via LLM")
        return intent

    # -- vocabulary hygiene ------------------------------------------------

    def _sanitize_preferences(self, preferences: list[str]) -> list[str]:
        """Caller-supplied preferences are untrusted input, like LLM output.

        The UI, the API route and the clarification flow can all put arbitrary
        strings here. Anything outside the controlled vocabulary would survive
        to the dietary filter, match no OSM tag, and silently zero out every
        result.
        """
        return [
            p.strip().lower()
            for p in preferences
            if isinstance(p, str) and p.strip().lower() in DIETARY_VOCABULARY
        ]

    # -- LLM path ----------------------------------------------------------

    async def _process_with_llm(self, request: DietaryRequest) -> ParsedIntent:
        """Ask the model for JSON intent; raises LLMUnavailableError on any failure."""
        vocabulary = list(DIETARY_KEYWORDS.keys())

        system = "\n".join(
            [
                "You extract structured dining intent from a diner's free-text request.",
                "Return ONLY a JSON object. No prose, no explanation, no markdown code fences.",
                "",
                "The object must have exactly this shape:",
                "{",
                '  "dietaryNeeds": string[],',
                '  "allergies": string[],',
                '  "location": string,',
                '  "cuisineType": string|null,',
                '  "mealType": string|null,',
                '  "priceRange": "budget"|"moderate"|"premium"|"any"',
                "}",
                "",
                f'"dietaryNeeds" may only contain values from this list: {json.dumps(vocabulary)}.',
                'Infer them from phrasing rather than exact wording -- "can\'t have gluten" is',
                '"gluten-free", "no animal products" is "vegan", "lactose intolerant" is "dairy-free".',
                "Never invent a category outside the list. Use [] when none apply.",
                "",
                '"allergies" is free text -- list any allergen the diner says they must avoid',
                '(e.g. "allergic to peanuts" -> ["peanuts"]). This is separate from a dietary',
                "preference: an allergy is something that would harm them, not something they",
                "choose. Use [] when none are mentioned.",
                "",
                f'"cuisineType" must be exactly one of {json.dumps(CUISINE_KEYWORDS)}, or null.',
                f'"mealType" must be exactly one of {json.dumps(MEAL_TYPES)}, or null.',
                '"priceRange" must be exactly one of "budget", "moderate", "premium", or "any".',
                'Use "any" when the diner said nothing about price.',
                "",
                '"location" is the place the diner wants to eat, copied as plainly as it appears',
                'in the query (a neighborhood, city, or landmark). Use "" if no location is stated.',
                "Do not guess a location and do not judge whether it is specific enough.",
            ]
        )

        user = "\n".join(
            [
                f"Query: {request.query}",
                "Dietary preferences already on file: "
                f"{json.dumps(request.dietaryPreferences)}",
            ]
        )

        raw = await call_llm(system=system, user=user, json_mode=True)

        try:
            parsed: dict[str, Any] = parse_json_response(raw)
        except ValueError as error:
            raise LLMUnavailableError(
                f"Could not parse JSON from LLM response: {error}"
            ) from None

        # Every field below is validated before use -- the model's output is not
        # trusted to stay inside the controlled vocabularies.
        needs = list(dict.fromkeys(self._sanitize_preferences(request.dietaryPreferences)))
        raw_needs = parsed.get("dietaryNeeds")
        if isinstance(raw_needs, list):
            for need in raw_needs:
                if isinstance(need, str) and need in vocabulary and need not in needs:
                    needs.append(need)

        # Allergies are free text -- there is no controlled vocabulary, because
        # OSM has no allergen data to match them against. They are never used to
        # filter; they drive warnings and the call-ahead affordance only.
        allergies = self._normalize_allergies(request.allergies)
        raw_allergies = parsed.get("allergies")
        if isinstance(raw_allergies, list):
            for allergy in raw_allergies:
                if isinstance(allergy, str) and allergy.strip():
                    value = allergy.strip().lower()
                    if value not in allergies:
                        allergies.append(value)

        # A caller-supplied location always wins, matching the rule-based path.
        raw_location = parsed.get("location")
        extracted = raw_location.strip() if isinstance(raw_location, str) else ""
        location = request.location or extracted

        cuisine = parsed.get("cuisineType")
        cuisine_type = cuisine if isinstance(cuisine, str) and cuisine in CUISINE_KEYWORDS else None

        meal = parsed.get("mealType")
        meal_type = meal if isinstance(meal, str) and meal in MEAL_TYPES else None

        price = parsed.get("priceRange")
        price_range = price if price in PRICE_RANGES else "any"

        return ParsedIntent(
            dietaryNeeds=needs,
            restrictions=allergies,
            location=location,
            # Ambiguity stays deterministic -- the LLM is not asked to judge it.
            isLocationAmbiguous=self._is_location_ambiguous(location),
            cuisineType=cuisine_type,
            mealType=meal_type,
            priceRange=price_range,  # type: ignore[arg-type]
        )

    # -- deterministic fallback -------------------------------------------

    def _process_with_rules(self, request: DietaryRequest) -> ParsedIntent:
        """Keyword/regex parser used when the LLM is unavailable."""
        query = request.query.lower()
        location, ambiguous = self._extract_location_rule_based(query, request)
        return ParsedIntent(
            dietaryNeeds=self._extract_needs_rule_based(query, request),
            restrictions=self._normalize_allergies(request.allergies),
            location=location,
            isLocationAmbiguous=ambiguous,
            cuisineType=self._extract_cuisine_rule_based(query),
            mealType=self._extract_meal_type_rule_based(query),
            priceRange=self._extract_price_range_rule_based(query),
        )

    def _extract_needs_rule_based(
        self, query: str, request: DietaryRequest
    ) -> list[str]:
        needs = list(dict.fromkeys(self._sanitize_preferences(request.dietaryPreferences)))
        for need, keywords in DIETARY_KEYWORDS.items():
            if any(kw in query for kw in keywords) and need not in needs:
                needs.append(need)
        return needs

    def _normalize_allergies(self, allergies: list[str]) -> list[str]:
        """Normalized identically on both paths, so downstream warnings and the
        call-ahead affordance behave the same with or without an API key."""
        seen: list[str] = []
        for allergy in allergies:
            if not isinstance(allergy, str):
                continue
            value = allergy.strip().lower()
            if value and value not in seen:
                seen.append(value)
        return seen

    def _extract_location_rule_based(
        self, query: str, request: DietaryRequest
    ) -> tuple[str, bool]:
        if request.location:
            return request.location, self._is_location_ambiguous(request.location)

        for pattern in LOCATION_PATTERNS:
            match = pattern.search(query)
            if match:
                loc = match.group(1).strip()
                return loc, self._is_location_ambiguous(loc)

        return "", True

    def _is_location_ambiguous(self, location: str) -> bool:
        lowered = location.lower()
        if any(term in lowered for term in AMBIGUOUS_TERMS):
            return True
        return len(location.strip()) < 3

    def _extract_cuisine_rule_based(self, query: str) -> Optional[str]:
        return next((c for c in CUISINE_KEYWORDS if c in query), None)

    def _extract_meal_type_rule_based(self, query: str) -> Optional[str]:
        return next((m for m in MEAL_TYPES if m in query), None)

    def _extract_price_range_rule_based(self, query: str) -> str:
        if re.search(r"cheap|budget|affordable|inexpensive", query):
            return "budget"
        if re.search(r"moderate|mid-range|reasonable", query):
            return "moderate"
        if re.search(r"upscale|fine dining|expensive|premium|fancy", query):
            return "premium"
        return "any"
