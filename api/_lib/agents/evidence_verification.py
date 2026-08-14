"""Evidence Verification Agent.

Each Evidence item is a literal restatement of an OpenStreetMap tag. The
original implementation hardcoded ``confidence=0.75, verified=True,
menuConfirmed=True`` for every dietary option a place had -- including options
the user never asked for -- and asserted that a diet tag "is essentially a menu
confirmation", which is not true. A tag says someone once recorded a claim; it
does not say a menu was inspected.

The split that matters: whether the tag exists is a fact (``verified``), while
whether it is still accurate is a belief derived from its check date
(``confidence``). Both are computed in code -- an LLM has no business asserting
either.
"""

from __future__ import annotations

from typing import Optional

from ..confidence_scorer import recency_score
from ..tools.diet_tags import DIET_TAG_ALTERNATIVES
from ..types import Evidence, ParsedIntent, Restaurant


class EvidenceVerificationAgent:
    async def process(
        self,
        restaurants: list[Restaurant],
        intent: ParsedIntent,
        enforceable_needs: list[str],
        unenforceable_needs: list[str],
    ) -> list[Evidence]:
        """One Evidence item per OSM tag that answers a requested need."""
        evidence: list[Evidence] = []

        for restaurant in restaurants:
            belief = recency_score(restaurant.lastCheckedISO)

            # One item per requested need OSM can express, quoting the tag.
            for need in enforceable_needs:
                tag = self._matching_tag(restaurant, need)
                if tag is None:
                    continue
                key, value = tag
                evidence.append(
                    Evidence(
                        restaurantId=restaurant.id,
                        claim=f"OpenStreetMap tag {key}={value}",
                        verified=True,
                        # A tag with no check date is still a real tag, so this
                        # floors at a low positive rather than zero.
                        confidence=max(0.4, belief),
                        menuConfirmed=False,
                    )
                )

            # And one per need OSM cannot express, so the gap is stated rather
            # than quietly omitted.
            for need in unenforceable_needs:
                evidence.append(
                    Evidence(
                        restaurantId=restaurant.id,
                        claim=(
                            f'OpenStreetMap has no data for "{need}" '
                            "-- it cannot be verified"
                        ),
                        verified=False,
                        confidence=0.0,
                        menuConfirmed=False,
                    )
                )

            for allergy in intent.restrictions:
                evidence.append(
                    Evidence(
                        restaurantId=restaurant.id,
                        claim=(
                            "OpenStreetMap holds no allergen or cross-contamination "
                            f'data, so "{allergy}" safety cannot be verified'
                        ),
                        verified=False,
                        confidence=0.0,
                        menuConfirmed=False,
                    )
                )

            if restaurant.lastCheckedISO:
                evidence.append(
                    Evidence(
                        restaurantId=restaurant.id,
                        claim=(
                            "Listing last confirmed by a mapper on "
                            f"{restaurant.lastCheckedISO}"
                        ),
                        verified=True,
                        confidence=belief,
                        menuConfirmed=False,
                    )
                )

        return evidence

    def _matching_tag(
        self, restaurant: Restaurant, need: str
    ) -> Optional[tuple[str, str]]:
        """The specific tag satisfying a need, for quoting verbatim."""
        for key in DIET_TAG_ALTERNATIVES.get(need, []):
            value = restaurant.dietTags.get(key)
            if value in ("yes", "only"):
                return key, value
        return None
