import { ParsedIntent, Restaurant } from "@/types";
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
 * Restaurant Discovery
 *
 * Deterministic by design. Which restaurants a person is shown must be
 * reproducible, so every decision here — radius, filtering, ordering — is made
 * in code. The dietary constraint is applied in the Overpass query and
 * re-asserted after parsing.
 */

/**
 * Fixed ladder. Widening when there are too few matches is a mechanical
 * decision with one correct answer, so it lives in code: an earlier revision
 * let the planning agent choose the radius and the end-to-end eval caught it
 * immediately — two runs of the same query picked different radii and returned
 * different restaurants. Anything that changes *which* restaurants a person
 * sees has to be reproducible.
 *
 * The agent's judgement is applied where judgement actually exists: reading the
 * request, asking for clarification, and explaining results.
 */
const RADIUS_LADDER_M = [2000, 5000, 10_000, 25_000];
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

    const { places, radiusSearchedM } = await this.searchWithLadder(
      intent,
      geocoded,
      enforceable
    );

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
   * Widens until there are enough matches. Deterministic and reproducible:
   * the same query at the same moment always issues the same sequence of
   * requests and returns the same restaurants.
   *
   * The diet filter is what makes this affordable — it cuts a city radius from
   * hundreds of places to tens, so the widest step is still a small response.
   */
  private async searchWithLadder(
    intent: ParsedIntent,
    geocoded: GeocodeResult,
    enforceableNeeds: string[]
  ): Promise<{ places: OverpassPlace[]; radiusSearchedM: number }> {
    let places: OverpassPlace[] = [];
    let radiusSearchedM = RADIUS_LADDER_M[0];

    for (const radiusM of RADIUS_LADDER_M) {
      radiusSearchedM = radiusM;
      places = await searchRestaurants({
        lat: geocoded.lat,
        lng: geocoded.lng,
        radiusM,
        dietNeeds: enforceableNeeds,
        cuisineType: intent.cuisineType,
      });
      const usable = places.filter((p) =>
        matchesAllNeeds(p.tags, enforceableNeeds)
      );
      if (usable.length >= MIN_RESULTS) break;
    }

    return { places, radiusSearchedM };
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
    for (const radius of RADIUS_LADDER_M) {
      if (radius > searchedM) break;
      const within = restaurants.filter((r) => (r.distance ?? Infinity) <= radius);
      if (within.length >= MIN_RESULTS) return radius;
    }
    return searchedM;
  }
}
