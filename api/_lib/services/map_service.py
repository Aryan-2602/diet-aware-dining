"""Map data for displaying recommendations.

Pure computation -- bounds, centre, zoom and marker URLs. No reasoning and no
I/O, which is why it is a service rather than an agent.
"""

from __future__ import annotations

from urllib.parse import quote

from ..types import Coordinates, MapBounds, MapData, MapMarkerData, Restaurant

DEFAULT_CENTER = Coordinates(lat=34.0522, lng=-118.2437)  # Los Angeles


class MapService:
    async def process(
        self, restaurants: list[Restaurant], confidence_map: dict[str, float]
    ) -> MapData:
        """Compute embed bounds, centre, zoom and marker URLs. Empty set defaults to LA."""
        if not restaurants:
            return MapData(
                center=DEFAULT_CENTER,
                zoom=13,
                markers=[],
                bounds=MapBounds(north=34.06, south=34.04, east=-118.23, west=-118.26),
            )

        markers = [self._create_marker(r, confidence_map) for r in restaurants]
        bounds = self._calculate_bounds(markers)
        return MapData(
            center=self._calculate_center(markers),
            zoom=self._calculate_zoom(bounds),
            markers=markers,
            bounds=bounds,
        )

    def _create_marker(
        self, restaurant: Restaurant, confidence_map: dict[str, float]
    ) -> MapMarkerData:
        lat = restaurant.location.lat
        lng = restaurant.location.lng
        address = quote(restaurant.address, safe="")
        return MapMarkerData(
            restaurantId=restaurant.id,
            name=restaurant.name,
            lat=lat,
            lng=lng,
            confidence=confidence_map.get(restaurant.id, 0.0),
            dietaryOptions=restaurant.dietaryOptions,
            googleMapsUrl=(
                "https://www.google.com/maps/dir/?api=1"
                f"&destination={lat},{lng}&destination_place_id={address}"
            ),
        )

    def _calculate_bounds(self, markers: list[MapMarkerData]) -> MapBounds:
        lats = [m.lat for m in markers]
        lngs = [m.lng for m in markers]
        return MapBounds(
            north=max(lats) + 0.005,
            south=min(lats) - 0.005,
            east=max(lngs) + 0.005,
            west=min(lngs) - 0.005,
        )

    def _calculate_center(self, markers: list[MapMarkerData]) -> Coordinates:
        return Coordinates(
            lat=sum(m.lat for m in markers) / len(markers),
            lng=sum(m.lng for m in markers) / len(markers),
        )

    def _calculate_zoom(self, bounds: MapBounds) -> int:
        max_diff = max(bounds.north - bounds.south, bounds.east - bounds.west)
        if max_diff > 0.1:
            return 12
        if max_diff > 0.05:
            return 13
        if max_diff > 0.02:
            return 14
        return 15
