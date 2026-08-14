import { DiscoveryError, GeocodeFailedError } from "@/lib/errors";

/**
 * Nominatim geocoding.
 *
 * Two things the previous implementation got wrong and this one does not:
 * it distinguished nothing (a 500 and "no such place" both became `null`, then
 * `[]`, then "no restaurants found"), and it re-ran on every relaxation attempt,
 * issuing three requests per search against a service whose usage policy allows
 * one per second.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const TIMEOUT_MS = 5000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  /** [south, north, west, east] as returned by Nominatim. */
  boundingBox?: [number, number, number, number];
}

interface NominatimEntry {
  lat: string;
  lon: string;
  display_name: string;
  boundingbox?: [string, string, string, string];
}

/** Process-lifetime cache. Repeat searches for a city cost one request, not N. */
const cache = new Map<string, GeocodeResult>();

export async function geocode(location: string): Promise<GeocodeResult> {
  const key = location.trim().toLowerCase();
  if (!key) throw new GeocodeFailedError(location);

  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: location,
    format: "json",
    limit: "1",
    addressdetails: "0",
  });

  let response: Response;
  try {
    response = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: {
        // Nominatim's policy requires an identifiable app with contact info.
        "User-Agent":
          "DietAwareDining/2.0 (https://github.com/Aryan-2602/diet-aware-dining)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DiscoveryError(
      "geocode_unavailable",
      `Could not reach the geocoding service: ${detail}`
    );
  }

  if (!response.ok) {
    throw new DiscoveryError(
      "geocode_unavailable",
      `Geocoding service returned ${response.status}`
    );
  }

  let entries: NominatimEntry[];
  try {
    entries = (await response.json()) as NominatimEntry[];
  } catch {
    throw new DiscoveryError(
      "geocode_unavailable",
      "Geocoding service returned a non-JSON response"
    );
  }

  // An empty array is a real answer — the place does not exist — and is a
  // different outcome from the service being down.
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new GeocodeFailedError(location);
  }

  const entry = entries[0];
  const lat = parseFloat(entry.lat);
  const lng = parseFloat(entry.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new GeocodeFailedError(location);
  }

  const result: GeocodeResult = {
    lat,
    lng,
    displayName: entry.display_name,
    boundingBox: entry.boundingbox?.map(Number) as
      | [number, number, number, number]
      | undefined,
  };

  cache.set(key, result);
  return result;
}
