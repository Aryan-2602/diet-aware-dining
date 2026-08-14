"""Recommendation Agent.

Ranking is deterministic; only the prose is generated. The original version
mapped every restaurant 1:1 into a recommendation with no filter at all, so a
place with no dietary tags could be returned at rank #1 for a vegan search with
nothing more than a missing "match reason" to hint at it.

The dietary filter is applied here for the third time -- the Overpass query
filters, discovery re-asserts, and this is the last gate before a result reaches
a person. Cheap, and it means no future refactor of the layers above can quietly
surface an unverified match.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..errors import LLMUnavailableError
from ..llm_client import call_llm, parse_json_response
from ..tools.diet_tags import cuisine_matches, matches_all_needs
from ..types import (
    ConfidenceScore,
    Evidence,
    ParsedIntent,
    Recommendation,
    Restaurant,
)

logger = logging.getLogger(__name__)


class RecommendationAgent:
    async def process(
        self,
        restaurants: list[Restaurant],
        scores: list[ConfidenceScore],
        evidence: list[Evidence],
        intent: ParsedIntent,
        enforceable_needs: list[str],
        unenforceable_needs: list[str],
    ) -> list[Recommendation]:
        """Hard-filter on diet tags, rank by score, then write match/warning copy."""
        safe = [
            r for r in restaurants if matches_all_needs(r.dietTags, enforceable_needs)
        ]

        by_id = {s.restaurantId: s for s in scores}
        ranked = [
            (
                restaurant,
                by_id.get(restaurant.id) or self._zero_score(restaurant.id),
                [e for e in evidence if e.restaurantId == restaurant.id],
            )
            for restaurant in safe
        ]

        # When allergies are in play, a place we can phone is materially more
        # useful than one we cannot, because calling ahead is the only real
        # verification available.
        has_allergies = bool(intent.restrictions)
        ranked.sort(
            key=lambda item: (
                (0 if item[0].phone else 1) if has_allergies else 0,
                -item[1].overall,
                item[0].id,
            )
        )

        copy = await self._write_copy(ranked, intent, unenforceable_needs)

        return [
            Recommendation(
                restaurant=restaurant,
                confidence=score,
                evidence=items,
                matchReasons=copy.get(restaurant.id, {}).get("matchReasons")
                or self._fallback_reasons(restaurant, intent, enforceable_needs),
                # Warnings are always computed in code and merged, never left to
                # the model -- a dropped safety caveat is not an acceptable
                # failure mode.
                warnings=self._mandatory_warnings(
                    restaurant, intent, unenforceable_needs
                )
                + (copy.get(restaurant.id, {}).get("warnings") or []),
            )
            for restaurant, score, items in ranked
        ]

    def _zero_score(self, restaurant_id: str) -> ConfidenceScore:
        return ConfidenceScore(
            restaurantId=restaurant_id,
            overall=0.0,
            dietTagStrength=0.0,
            coverage=0.0,
            tagRecency=0.0,
            dataCompleteness=0.0,
        )

    async def _write_copy(
        self,
        ranked: list[tuple[Restaurant, ConfidenceScore, list[Evidence]]],
        intent: ParsedIntent,
        unenforceable_needs: list[str],
    ) -> dict[str, dict[str, list[str]]]:
        """LLM writes the human-facing reasons. Falls back to templates."""
        if not ranked:
            return {}

        system = "\n".join(
            [
                "You write short, factual explanations for restaurant recommendations.",
                "Return ONLY a JSON object keyed by restaurant id:",
                '{ "<id>": { "matchReasons": string[], "warnings": string[] } }',
                "",
                "Rules:",
                "- Every statement must be supported by the OpenStreetMap tags provided.",
                "- Never claim a menu was checked, a dish is available, or that a place is",
                "  safe for an allergy. OpenStreetMap contains none of that information.",
                "- 1-2 short match reasons each. Use [] for warnings if you have nothing",
                "  factual to add; safety caveats are added separately.",
                "- Do not mention prices, ratings or reviews: there is no such data.",
            ]
        )

        payload = [
            {
                "id": restaurant.id,
                "name": restaurant.name,
                "cuisine": restaurant.cuisine,
                "dietTags": restaurant.dietTags,
                "distanceM": restaurant.distance,
                "lastChecked": restaurant.lastCheckedISO,
                "verificationStrength": score.overall,
            }
            for restaurant, score, _ in ranked[:10]
        ]

        user = "\n".join(
            [
                "Diner asked for: "
                f"{', '.join(intent.dietaryNeeds) or 'no dietary requirement'}",
                f"Cuisine preference: {intent.cuisineType or 'none'}",
                "Cannot be verified from OpenStreetMap: "
                f"{', '.join(unenforceable_needs) or 'nothing'}",
                f"Restaurants: {json.dumps(payload)}",
            ]
        )

        try:
            raw = await call_llm(
                system=system, user=user, max_tokens=900, json_mode=True
            )
            parsed: dict[str, Any] = parse_json_response(raw)
        except (LLMUnavailableError, ValueError) as error:
            logger.warning(
                "[RecommendationAgent] copy generation unavailable, using "
                "templates: %s",
                error,
            )
            return {}

        out: dict[str, dict[str, list[str]]] = {}
        if isinstance(parsed, dict):
            for key, value in parsed.items():
                if not isinstance(value, dict):
                    continue
                out[key] = {
                    "matchReasons": self._string_list(value.get("matchReasons")),
                    "warnings": self._string_list(value.get("warnings")),
                }
        return out

    def _string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [v.strip() for v in value if isinstance(v, str) and v.strip()]

    def _fallback_reasons(
        self,
        restaurant: Restaurant,
        intent: ParsedIntent,
        enforceable_needs: list[str],
    ) -> list[str]:
        reasons: list[str] = []
        for need in enforceable_needs:
            tag = next(
                (
                    (k, v)
                    for k, v in restaurant.dietTags.items()
                    if v in ("only", "yes")
                ),
                None,
            )
            if tag:
                key, value = tag
                reasons.append(
                    f"Entirely {need} according to OpenStreetMap ({key}=only)"
                    if value == "only"
                    else f"Tagged {need} in OpenStreetMap ({key}=yes)"
                )
                break

        if cuisine_matches(restaurant.cuisine, intent.cuisineType):
            reasons.append(f"Serves {intent.cuisineType} cuisine")
        if restaurant.distance is not None:
            reasons.append(f"{restaurant.distance / 1000:.1f} km away")
        return reasons

    def _mandatory_warnings(
        self,
        restaurant: Restaurant,
        intent: ParsedIntent,
        unenforceable_needs: list[str],
    ) -> list[str]:
        """Non-negotiable caveats, present regardless of what the LLM wrote."""
        warnings: list[str] = []

        if intent.restrictions:
            call = f" -- call {restaurant.phone}" if restaurant.phone else ""
            warnings.append(
                "OpenStreetMap has no allergen or cross-contamination data. Tell "
                f"staff about your {' and '.join(intent.restrictions)} allergy "
                f"before ordering{call}."
            )

        for need in unenforceable_needs:
            warnings.append(
                f'OpenStreetMap cannot confirm "{need}" -- no such tag exists. '
                "Check directly."
            )

        if not restaurant.lastCheckedISO:
            warnings.append(
                "No mapper has recorded when this listing was last confirmed."
            )

        return warnings
