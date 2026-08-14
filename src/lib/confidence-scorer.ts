import { ConfidenceScore, Restaurant } from "@/types";
import { dietTagStrength } from "@/lib/tools/diet-tags";

/**
 * Deterministic confidence scoring.
 *
 * Everything here derives from a real OpenStreetMap signal. The previous
 * implementation multiplied a fabricated rating by a fabricated review count
 * and added `0.7 + Math.random() * 0.3` for "recency", which meant the same
 * query returned a different set of restaurants in a different order on every
 * run. There is no random component here, and no input that OSM does not
 * actually provide.
 *
 * The score answers "how well attested is this place's dietary tagging", not
 * "does this match" — everything reaching the scorer has already passed the
 * hard dietary filter.
 */

const WEIGHTS = {
  dietTagStrength: 0.55,
  tagRecency: 0.2,
  coverage: 0.15,
  dataCompleteness: 0.1,
} as const;

const COMPLETENESS_FIELDS = 5;

export function scoreRestaurant(
  restaurant: Restaurant,
  enforceableNeeds: string[],
  allNeeds: string[]
): ConfidenceScore {
  const strength = dietTagStrength(restaurant.dietTags, enforceableNeeds);
  const recency = recencyScore(restaurant.lastCheckedISO);
  const coverage =
    allNeeds.length === 0
      ? 1 // Nothing was asked for, so nothing is unverified.
      : enforceableNeeds.length / allNeeds.length;
  const completeness = completenessScore(restaurant);

  // With no enforceable need there is no dietary evidence to weigh, so that
  // term is dropped and the remaining weights are renormalized rather than
  // dragging every score toward zero.
  const applicable: Array<[number, number]> =
    enforceableNeeds.length > 0
      ? [
          [strength, WEIGHTS.dietTagStrength],
          [recency, WEIGHTS.tagRecency],
          [coverage, WEIGHTS.coverage],
          [completeness, WEIGHTS.dataCompleteness],
        ]
      : [
          [recency, WEIGHTS.tagRecency],
          [coverage, WEIGHTS.coverage],
          [completeness, WEIGHTS.dataCompleteness],
        ];

  const totalWeight = applicable.reduce((sum, [, w]) => sum + w, 0);
  const weighted = applicable.reduce((sum, [value, w]) => sum + value * w, 0);
  const overall = totalWeight > 0 ? weighted / totalWeight : 0;

  return {
    restaurantId: restaurant.id,
    overall: round(overall),
    dietTagStrength: round(strength),
    coverage: round(coverage),
    tagRecency: round(recency),
    dataCompleteness: round(completeness),
  };
}

export function scoreRestaurants(
  restaurants: Restaurant[],
  enforceableNeeds: string[],
  allNeeds: string[]
): ConfidenceScore[] {
  return restaurants.map((r) => scoreRestaurant(r, enforceableNeeds, allNeeds));
}

/**
 * How recently a mapper confirmed the listing. Absent means unknown, which
 * scores 0 — not a middling default. "Nobody has checked" is information.
 */
export function recencyScore(checkDate: string | undefined): number {
  if (!checkDate) return 0;
  const checked = Date.parse(checkDate);
  if (!Number.isFinite(checked)) return 0;

  const years = (Date.now() - checked) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 0) return 0; // A future date is bad data, not fresh data.
  if (years < 1) return 1;
  if (years < 2) return 0.7;
  if (years < 4) return 0.4;
  return 0.2;
}

/**
 * Listing completeness. This is a data-quality signal, deliberately not a
 * popularity or quality one — OSM has no popularity data, and the previous
 * code presented exactly this number to users as a star rating.
 */
export function completenessScore(restaurant: Restaurant): number {
  const present = [
    restaurant.address !== "Address not in OpenStreetMap",
    Boolean(restaurant.openingHours),
    Boolean(restaurant.website),
    Boolean(restaurant.phone),
    restaurant.cuisine.length > 0 &&
      restaurant.cuisine[0] !== "restaurant" &&
      restaurant.cuisine[0] !== "cafe",
  ].filter(Boolean).length;
  return present / COMPLETENESS_FIELDS;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
