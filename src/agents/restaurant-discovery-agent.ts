import { ParsedIntent, Restaurant } from "@/types";
import { runAgent, type AgentTool } from "@/lib/agent";
import { LLMUnavailableError } from "@/lib/llm-client";
import { geocode, type GeocodeResult } from "@/lib/tools/geocode";
import {
  distanceMeters,
  searchRestaurants,
  type OverpassPlace,
} from "@/lib/tools/overpass";
import {
  cuisineMatches,
  extractDietTags,
  matchesAllNeeds,
  partitionNeeds,
} from "@/lib/tools/diet-tags";

/**
 * Restaurant Discovery Agent
 *
 * An LLM agent over two deterministic tools. It chooses the search strategy —
 * how wide to go, whether a cuisine preference is worth insisting on, when to
 * stop — while the dietary constraint is enforced inside the tools and
 * re-asserted here in code. Strategy is a judgement call; dietary safety is not.
 *
 * Falls back to a fixed strategy when the LLM is unavailable, so the app keeps
 * working with no API key.
 */

const DEFAULT_RADIUS_M = 8000;
const MAX_RADIUS_M = 25_000;
const MIN_RESULTS = 3;
const MAX_RESULTS = 15;

export interface DiscoveryOutcome {
  restaurants: Restaurant[];
  /** Needs OSM could not express, so could not be filtered on. */
  unenforceableNeeds: string[];
  enforceableNeeds: string[];
  /** Tightest radius that yielded at least MIN_RESULTS, else the widest tried. */
  effectiveRadiusM: number;
  radiusSearchedM: number;
  candidatesScanned: number;
  geocoded: GeocodeResult;
}

export class RestaurantDiscoveryAgent {
  async process(intent: ParsedIntent): Promise<DiscoveryOutcome> {
    // Geocoding happens exactly once, before any strategy is chosen. The old
    // implementation re-geocoded inside its relaxation recursion, issuing three
    // requests per search against a 1-req/s service.
    const geocoded = await geocode(intent.location);
    const { enforceable, unenforceable } = partitionNeeds(intent.dietaryNeeds);

    let places: OverpassPlace[];
    let radiusSearchedM = DEFAULT_RADIUS_M;

    try {
      const planned = await this.planWithLLM(intent, geocoded, enforceable);
      places = planned.places;
      radiusSearchedM = planned.radiusM;
    } catch (error) {
      if (!(error instanceof LLMUnavailableError)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[RestaurantDiscoveryAgent] planning unavailable, using default strategy: ${message}`
      );
      places = await searchRestaurants({
        lat: geocoded.lat,
        lng: geocoded.lng,
        radiusM: DEFAULT_RADIUS_M,
        dietNeeds: enforceable,
        cuisineType: intent.cuisineType,
      });
    }

    const candidatesScanned = places.length;
    const restaurants = this.toRestaurants(places, intent, enforceable, geocoded);

    return {
      restaurants: restaurants.slice(0, MAX_RESULTS),
      unenforceableNeeds: unenforceable,
      enforceableNeeds: enforceable,
      effectiveRadiusM: this.tightestUsefulRadius(restaurants, radiusSearchedM),
      radiusSearchedM,
      candidatesScanned,
      geocoded,
    };
  }

  /**
   * Lets the agent pick a radius and decide whether to widen. The diet
   * constraint is passed to the tool by us, not chosen by the model — the model
   * is never given the option to drop it.
   */
  private async planWithLLM(
    intent: ParsedIntent,
    geocoded: GeocodeResult,
    enforceableNeeds: string[]
  ): Promise<{ places: OverpassPlace[]; radiusM: number }> {
    let lastPlaces: OverpassPlace[] = [];
    let lastRadius = DEFAULT_RADIUS_M;

    const searchTool: AgentTool<{ radiusM?: number }, unknown> = {
      name: "search_restaurants",
      description:
        "Search OpenStreetMap for restaurants near the user's location. The " +
        "dietary requirement is always applied and cannot be disabled. Returns " +
        "how many matches were found at that radius.",
      parameters: {
        type: "object",
        properties: {
          radiusM: {
            type: "number",
            description: `Search radius in metres, ${1000}-${MAX_RADIUS_M}.`,
          },
        },
        required: ["radiusM"],
      },
      execute: async ({ radiusM }) => {
        const radius = Math.min(
          Math.max(Number(radiusM) || DEFAULT_RADIUS_M, 1000),
          MAX_RADIUS_M
        );
        const places = await searchRestaurants({
          lat: geocoded.lat,
          lng: geocoded.lng,
          radiusM: radius,
          dietNeeds: enforceableNeeds,
          cuisineType: intent.cuisineType,
        });
        lastPlaces = places;
        lastRadius = radius;

        const cuisineHits = intent.cuisineType
          ? places.filter((p) =>
              cuisineMatches(
                (p.tags.cuisine ?? "").split(";"),
                intent.cuisineType
              )
            ).length
          : null;

        return {
          radiusM: radius,
          matches: places.length,
          matchingRequestedCuisine: cuisineHits,
        };
      },
    };

    const system = [
      "You plan a restaurant search over OpenStreetMap.",
      "Call search_restaurants to find places, then reply with a one-sentence",
      "summary of what you searched. Reply with text only once you are done.",
      "",
      "Guidance:",
      `- Start around ${DEFAULT_RADIUS_M} metres.`,
      `- If there are fewer than ${MIN_RESULTS} matches, widen once (up to ${MAX_RADIUS_M} metres).`,
      "- If a wider search still finds nothing, stop. Reporting an honest empty",
      "  result is correct; there is no way to loosen the dietary requirement.",
      "- Do not widen when you already have enough matches; nearer is better.",
      "- Never call the tool more than three times.",
    ].join("\n");

    const user = [
      `Location: ${geocoded.displayName}`,
      `Dietary requirements enforced: ${
        enforceableNeeds.length ? enforceableNeeds.join(", ") : "none"
      }`,
      `Preferred cuisine: ${intent.cuisineType ?? "no preference"}`,
      `Original request: ${intent.location}`,
    ].join("\n");

    await runAgent({
      system,
      user,
      tools: [searchTool as AgentTool<never, unknown>],
      maxIterations: 4,
      maxTokens: 300,
    });

    // If the agent finished without ever searching, that is a planning failure,
    // not an empty result — fall back rather than reporting zero matches.
    if (!lastPlaces.length && lastRadius === DEFAULT_RADIUS_M) {
      const places = await searchRestaurants({
        lat: geocoded.lat,
        lng: geocoded.lng,
        radiusM: DEFAULT_RADIUS_M,
        dietNeeds: enforceableNeeds,
        cuisineType: intent.cuisineType,
      });
      return { places, radiusM: DEFAULT_RADIUS_M };
    }

    return { places: lastPlaces, radiusM: lastRadius };
  }

  /**
   * Maps Overpass elements to Restaurants and re-asserts the dietary filter in
   * code. Defence in depth: the query already filtered, but a stale mirror, a
   * future edit to the query builder, or `out` truncation must not be able to
   * put an unverified place in front of someone with a dietary requirement.
   */
  private toRestaurants(
    places: OverpassPlace[],
    intent: ParsedIntent,
    enforceableNeeds: string[],
    center: GeocodeResult
  ): Restaurant[] {
    return places
      .filter((place) => matchesAllNeeds(place.tags, enforceableNeeds))
      .map((place) => {
        const tags = place.tags;
        return {
          // node and way ids occupy separate namespaces and collide without
          // the type prefix, which previously cross-contaminated evidence.
          id: `osm-${place.osmType}-${place.osmId}`,
          name: tags.name,
          address: this.buildAddress(tags),
          cuisine: this.extractCuisine(tags),
          dietaryOptions: this.extractDietaryOptions(tags),
          dietTags: extractDietTags(tags),
          location: { lat: place.lat, lng: place.lng },
          osmType: place.osmType,
          osmId: place.osmId,
          distance: distanceMeters(center, { lat: place.lat, lng: place.lng }),
          openingHours: tags.opening_hours,
          website: tags.website ?? tags["contact:website"],
          phone: tags.phone ?? tags["contact:phone"],
          lastCheckedISO: this.extractCheckDate(tags, enforceableNeeds),
        } satisfies Restaurant;
      })
      .sort((a, b) => {
        // Requested cuisine first (it is a preference, not a constraint), then
        // distance. Deterministic: no random component anywhere.
        const aCuisine = cuisineMatches(a.cuisine, intent.cuisineType) ? 0 : 1;
        const bCuisine = cuisineMatches(b.cuisine, intent.cuisineType) ? 0 : 1;
        if (aCuisine !== bCuisine) return aCuisine - bCuisine;
        return (a.distance ?? Infinity) - (b.distance ?? Infinity);
      });
  }

  /** Prefers a need-specific check date over the listing-wide one. */
  private extractCheckDate(
    tags: Record<string, string>,
    enforceableNeeds: string[]
  ): string | undefined {
    for (const need of enforceableNeeds) {
      for (const key of Object.keys(tags)) {
        if (key.startsWith("check_date:diet:") && tags[key]) {
          return tags[key];
        }
      }
    }
    return tags.check_date ?? tags["survey:date"] ?? undefined;
  }

  private extractDietaryOptions(tags: Record<string, string>): string[] {
    const dietMap: Record<string, string> = {
      "diet:vegan": "vegan",
      "diet:vegetarian": "vegetarian",
      "diet:gluten_free": "gluten-free",
      "diet:lactose_free": "dairy-free",
      "diet:halal": "halal",
      "diet:kosher": "kosher",
    };
    const options: string[] = [];
    for (const [tag, label] of Object.entries(dietMap)) {
      if (tags[tag] === "yes" || tags[tag] === "only") options.push(label);
    }
    return options;
  }

  private extractCuisine(tags: Record<string, string>): string[] {
    const raw = tags.cuisine || tags.food || "";
    if (!raw) return [tags.amenity === "cafe" ? "cafe" : "restaurant"];
    return raw
      .split(";")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
  }

  private buildAddress(tags: Record<string, string>): string {
    const parts = [
      tags["addr:housenumber"],
      tags["addr:street"],
      tags["addr:city"],
      tags["addr:postcode"],
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "Address not in OpenStreetMap";
  }

  /** The tightest radius that still contains MIN_RESULTS, for honest reporting. */
  private tightestUsefulRadius(
    restaurants: Restaurant[],
    searchedM: number
  ): number {
    for (const radius of [1000, 2000, 5000, 10_000, MAX_RADIUS_M]) {
      if (radius > searchedM) break;
      const within = restaurants.filter((r) => (r.distance ?? Infinity) <= radius);
      if (within.length >= MIN_RESULTS) return radius;
    }
    return searchedM;
  }
}
