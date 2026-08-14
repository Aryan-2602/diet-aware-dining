import { Restaurant, ParsedIntent } from "@/types";

/**
 * Map Generation Agent
 * Generates map data for displaying restaurant recommendations on Google Maps.
 * Calculates optimal map bounds, generates markers, and creates navigation URLs.
 */
export interface MapMarker {
  restaurantId: string;
  name: string;
  lat: number;
  lng: number;
  confidence: number;
  dietaryOptions: string[];
  googleMapsUrl: string;
}

export interface MapData {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarker[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export class MapService {
  async process(
    restaurants: Restaurant[],
    _intent: ParsedIntent,
    confidenceMap: Map<string, number>
  ): Promise<MapData> {
    if (restaurants.length === 0) {
      return {
        center: { lat: 34.0522, lng: -118.2437 }, // Default LA
        zoom: 13,
        markers: [],
        bounds: { north: 34.06, south: 34.04, east: -118.23, west: -118.26 },
      };
    }

    const markers = restaurants.map((r) => this.createMarker(r, confidenceMap));
    const bounds = this.calculateBounds(markers);
    const center = this.calculateCenter(markers);
    const zoom = this.calculateZoom(bounds);

    return { center, zoom, markers, bounds };
  }

  private createMarker(
    restaurant: Restaurant,
    confidenceMap: Map<string, number>
  ): MapMarker {
    const { lat, lng } = restaurant.location;
    const address = encodeURIComponent(restaurant.address);

    return {
      restaurantId: restaurant.id,
      name: restaurant.name,
      lat,
      lng,
      confidence: confidenceMap.get(restaurant.id) || 0,
      dietaryOptions: restaurant.dietaryOptions,
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${address}`,
    };
  }

  private calculateBounds(markers: MapMarker[]) {
    const lats = markers.map((m) => m.lat);
    const lngs = markers.map((m) => m.lng);

    return {
      north: Math.max(...lats) + 0.005,
      south: Math.min(...lats) - 0.005,
      east: Math.max(...lngs) + 0.005,
      west: Math.min(...lngs) - 0.005,
    };
  }

  private calculateCenter(markers: MapMarker[]) {
    const avgLat =
      markers.reduce((sum, m) => sum + m.lat, 0) / markers.length;
    const avgLng =
      markers.reduce((sum, m) => sum + m.lng, 0) / markers.length;
    return { lat: avgLat, lng: avgLng };
  }

  private calculateZoom(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): number {
    const latDiff = bounds.north - bounds.south;
    const lngDiff = bounds.east - bounds.west;
    const maxDiff = Math.max(latDiff, lngDiff);

    if (maxDiff > 0.1) return 12;
    if (maxDiff > 0.05) return 13;
    if (maxDiff > 0.02) return 14;
    return 15;
  }
}
