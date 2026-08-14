"""Core domain types.

Mirrors the TypeScript interfaces the React frontend still consumes, so the
JSON contract across the wire is unchanged. Field names stay camelCase for
exactly that reason -- renaming them to snake_case here would silently break
every component that reads them.

There is deliberately no ``rating``, ``review_count``, ``price_level`` or
``source`` on Restaurant: OpenStreetMap has none of those, and an earlier
version of this app synthesized them from how many tags a place happened to
carry and then displayed them as if they came from Google or Yelp.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

OsmElementType = Literal["node", "way", "relation"]
PriceRange = Literal["budget", "moderate", "premium", "any"]


@dataclass
class DietaryRequest:
    query: str
    location: str = ""
    dietaryPreferences: list[str] = field(default_factory=list)
    allergies: list[str] = field(default_factory=list)
    cuisinePreferences: list[str] = field(default_factory=list)


@dataclass
class ParsedIntent:
    dietaryNeeds: list[str]
    restrictions: list[str]
    location: str
    isLocationAmbiguous: bool
    cuisineType: Optional[str] = None
    mealType: Optional[str] = None
    priceRange: PriceRange = "any"


@dataclass
class ClarificationQuestion:
    field_: str
    question: str
    options: Optional[list[str]] = None

    def to_json(self) -> dict[str, Any]:
        # The frontend reads `field`; it is spelled field_ here only because
        # `field` collides with dataclasses.field in this module.
        return {
            "field": self.field_,
            "question": self.question,
            "options": self.options,
        }


@dataclass
class Coordinates:
    lat: float
    lng: float

    def to_json(self) -> dict[str, float]:
        return {"lat": self.lat, "lng": self.lng}


@dataclass
class Restaurant:
    id: str
    name: str
    address: str
    cuisine: list[str]
    dietaryOptions: list[str]
    dietTags: dict[str, str]
    location: Coordinates
    osmType: OsmElementType
    osmId: int
    distance: Optional[int] = None
    openingHours: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    lastCheckedISO: Optional[str] = None

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "address": self.address,
            "cuisine": self.cuisine,
            "dietaryOptions": self.dietaryOptions,
            "dietTags": self.dietTags,
            "location": self.location.to_json(),
            "osmType": self.osmType,
            "osmId": self.osmId,
            "distance": self.distance,
            "openingHours": self.openingHours,
            "website": self.website,
            "phone": self.phone,
            "lastCheckedISO": self.lastCheckedISO,
        }


@dataclass
class Evidence:
    restaurantId: str
    claim: str
    #: Whether the underlying OSM tag exists. A fact, not a judgement.
    verified: bool
    #: Belief the tag is still accurate, derived from its check date.
    confidence: float
    menuConfirmed: bool

    def to_json(self) -> dict[str, Any]:
        return {
            "restaurantId": self.restaurantId,
            "claim": self.claim,
            "verified": self.verified,
            "confidence": self.confidence,
            "menuConfirmed": self.menuConfirmed,
        }


@dataclass
class ConfidenceScore:
    restaurantId: str
    overall: float
    #: ``only`` outranks ``yes``: whole-establishment beats some-options.
    dietTagStrength: float
    #: Share of the user's needs OSM can express at all.
    coverage: float
    #: Derived from OSM check_date.
    tagRecency: float
    #: Listing completeness -- explicitly not a popularity signal.
    dataCompleteness: float

    def to_json(self) -> dict[str, Any]:
        return {
            "restaurantId": self.restaurantId,
            "overall": self.overall,
            "dietTagStrength": self.dietTagStrength,
            "coverage": self.coverage,
            "tagRecency": self.tagRecency,
            "dataCompleteness": self.dataCompleteness,
        }


@dataclass
class Recommendation:
    restaurant: Restaurant
    confidence: ConfidenceScore
    evidence: list[Evidence]
    matchReasons: list[str]
    warnings: list[str]

    def to_json(self) -> dict[str, Any]:
        return {
            "restaurant": self.restaurant.to_json(),
            "confidence": self.confidence.to_json(),
            "evidence": [e.to_json() for e in self.evidence],
            "matchReasons": self.matchReasons,
            "warnings": self.warnings,
        }


@dataclass
class MapMarkerData:
    restaurantId: str
    name: str
    lat: float
    lng: float
    confidence: float
    dietaryOptions: list[str]
    googleMapsUrl: str

    def to_json(self) -> dict[str, Any]:
        return {
            "restaurantId": self.restaurantId,
            "name": self.name,
            "lat": self.lat,
            "lng": self.lng,
            "confidence": self.confidence,
            "dietaryOptions": self.dietaryOptions,
            "googleMapsUrl": self.googleMapsUrl,
        }


@dataclass
class MapBounds:
    north: float
    south: float
    east: float
    west: float

    def to_json(self) -> dict[str, float]:
        return {
            "north": self.north,
            "south": self.south,
            "east": self.east,
            "west": self.west,
        }


@dataclass
class MapData:
    center: Coordinates
    zoom: int
    markers: list[MapMarkerData]
    bounds: MapBounds

    def to_json(self) -> dict[str, Any]:
        return {
            "center": self.center.to_json(),
            "zoom": self.zoom,
            "markers": [m.to_json() for m in self.markers],
            "bounds": self.bounds.to_json(),
        }


@dataclass
class PipelineMeta:
    """What the run produced, beyond the recommendations themselves."""

    enforceableNeeds: list[str]
    #: Needs OSM cannot express -- surfaced to the user, never silently dropped.
    unenforceableNeeds: list[str]
    effectiveRadiusM: int
    radiusSearchedM: int
    candidatesScanned: int
    resolvedLocation: str

    def to_json(self) -> dict[str, Any]:
        return {
            "enforceableNeeds": self.enforceableNeeds,
            "unenforceableNeeds": self.unenforceableNeeds,
            "effectiveRadiusM": self.effectiveRadiusM,
            "radiusSearchedM": self.radiusSearchedM,
            "candidatesScanned": self.candidatesScanned,
            "resolvedLocation": self.resolvedLocation,
        }


def parsed_intent_to_json(intent: Optional[ParsedIntent]) -> Optional[dict[str, Any]]:
    if intent is None:
        return None
    return {
        "dietaryNeeds": intent.dietaryNeeds,
        "restrictions": intent.restrictions,
        "location": intent.location,
        "isLocationAmbiguous": intent.isLocationAmbiguous,
        "cuisineType": intent.cuisineType,
        "mealType": intent.mealType,
        "priceRange": intent.priceRange,
    }
