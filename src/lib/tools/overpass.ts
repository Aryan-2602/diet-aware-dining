import { DiscoveryError } from "@/lib/errors";
import { cuisineFilter, dietFiltersForNeed } from "@/lib/tools/diet-tags";

/**
 * Overpass search.
 *
 * The old query was `node/way["amenity"=restaurant|cafe] ... out center 30;`
 * with the dietary filter computed and then discarded. Two consequences,
 * both measured against live data:
 *
 *   - `out center 30` returns the 30 *lowest OSM ids* — the oldest objects, not
 *     the nearest. Zero of the true 15 nearest restaurants appeared in the
 *     result set, and the `way[...]` clauses were dead code because 30 nodes
 *     filled the quota first, making every building-mapped restaurant invisible.
 *   - Without the diet filter, "vegan" searched the same 30 arbitrary places as
 *     "restaurants", so tagged vegan places usually were not even candidates.
 *
 * Filtering on `diet:*` server-side cuts a 927-place city radius to ~36, which
 * is what makes a single wide query affordable and why the hard filter
 * *increases* useful results rather than emptying them.
 */

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  // overpass-api.de allows 2 slots per IP and returns 504s under load; this
  // mirror was verified serving correctly while the primary was saturated.
  "https://overpass.kumi.systems/api/interpreter",
];
// Kept tight deliberately: the mirrors are tried in sequence, so this bounds
// the worst case at roughly 2x. Overpass answers a diet-filtered query in well
// under a second when healthy; a slow response means it is saturated, and
// failing over to the next mirror beats waiting.
const TIMEOUT_MS = 12_000;
const SERVER_TIMEOUT_S = 12;
const MAX_ELEMENTS = 200;
const MAX_STATEMENTS = 8;
const AMENITIES = ["restaurant", "cafe", "fast_food"];

export interface OverpassPlace {
  osmType: "node" | "way" | "relation";
  osmId: number;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

export interface SearchRestaurantsArgs {
  lat: number;
  lng: number;
  radiusM: number;
  /** Enforceable needs only. Applied as a hard server-side constraint. */
  dietNeeds: string[];
  /** Applied only when there is no diet constraint to bound the result set. */
  cuisineType?: string;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * The cross-product of each need's alternative tags. A need like `vegetarian`
 * is satisfied by `diet:vegetarian` OR `diet:vegan`, and Overpass has no OR
 * within a statement — so alternatives become separate union statements while
 * multiple needs AND together as repeated filters on one statement.
 */
export function dietFilterCombinations(needs: string[]): string[][] {
  let combos: string[][] = [[]];
  for (const need of needs) {
    const alternatives = dietFiltersForNeed(need);
    if (alternatives.length === 0) continue;
    const next: string[][] = [];
    for (const combo of combos) {
      for (const alternative of alternatives) {
        next.push([...combo, alternative]);
      }
    }
    combos = next;
  }

  // Degrade to strict AND rather than emitting an unbounded union.
  if (combos.length > MAX_STATEMENTS) {
    return [needs.map((need) => dietFiltersForNeed(need)[0]).filter(Boolean)];
  }
  return combos;
}

export function buildOverpassQuery({
  lat,
  lng,
  radiusM,
  dietNeeds,
  cuisineType,
}: SearchRestaurantsArgs): string {
  const amenity = `["amenity"~"^(${AMENITIES.join("|")})$"]`;
  const around = `(around:${Math.round(radiusM)},${lat},${lng})`;

  // Cuisine is a *soft* preference: 22% of places carry no `cuisine` tag at
  // all, including vegan ones, so filtering on it server-side silently discards
  // valid matches. It is only used to bound the query when there is no diet
  // filter doing that job.
  const cuisine =
    dietNeeds.length === 0 && cuisineType ? cuisineFilter(cuisineType) ?? "" : "";

  const combinations = dietFilterCombinations(dietNeeds);
  const statements = combinations.map(
    (filters) =>
      `  nwr${amenity}["name"]${filters.join("")}${cuisine}${around};`
  );

  return [
    `[out:json][timeout:${SERVER_TIMEOUT_S}];`,
    "(",
    ...statements,
    ");",
    `out tags center ${MAX_ELEMENTS};`,
  ].join("\n");
}

export async function searchRestaurants(
  args: SearchRestaurantsArgs
): Promise<OverpassPlace[]> {
  const query = buildOverpassQuery(args);
  const data = await fetchWithMirrors(query);
  return parseElements(data.elements ?? []);
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

async function fetchWithMirrors(query: string): Promise<OverpassResponse> {
  let lastError: DiscoveryError | null = null;

  for (const url of OVERPASS_MIRRORS) {
    try {
      return await fetchOverpass(url, query);
    } catch (error) {
      if (error instanceof DiscoveryError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastError ??
    new DiscoveryError("overpass_unavailable", "No Overpass mirror responded")
  );
}

async function fetchOverpass(
  url: string,
  query: string
): Promise<OverpassResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent":
          "DietAwareDining/2.0 (https://github.com/Aryan-2602/diet-aware-dining)",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new DiscoveryError(
        "overpass_timeout",
        `Overpass timed out after ${TIMEOUT_MS}ms`
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new DiscoveryError("overpass_unavailable", detail);
  }

  if (!response.ok) {
    throw new DiscoveryError(
      "overpass_unavailable",
      `Overpass returned ${response.status}`
    );
  }

  // Overpass answers a rate-limited request with HTTP 200 and an XHTML error
  // page. Parsing that as "zero elements" is what turned rate limits into
  // "no restaurants found".
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new DiscoveryError(
      "overpass_unavailable",
      `Overpass returned ${contentType || "an unknown content type"} instead of JSON (usually rate limiting)`
    );
  }

  let payload: OverpassResponse;
  try {
    payload = (await response.json()) as OverpassResponse;
  } catch {
    throw new DiscoveryError(
      "overpass_unavailable",
      "Overpass returned a malformed JSON body"
    );
  }

  // A `remark` signals a server-side timeout or truncation. Treating it as an
  // empty result set reports partial data as complete.
  if (payload.remark) {
    throw new DiscoveryError(
      "overpass_timeout",
      `Overpass reported: ${payload.remark}`
    );
  }

  return payload;
}

function parseElements(elements: OverpassElement[]): OverpassPlace[] {
  const places: OverpassPlace[] = [];
  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !element.tags?.name ||
      (element.type !== "node" &&
        element.type !== "way" &&
        element.type !== "relation")
    ) {
      continue;
    }
    places.push({
      osmType: element.type,
      osmId: element.id,
      lat: lat as number,
      lng: lng as number,
      tags: element.tags,
    });
  }
  return places;
}

/** Metres between two coordinates (haversine). */
export function distanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const R = 6_371_000;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
