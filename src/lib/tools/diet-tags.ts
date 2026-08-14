/**
 * The mapping between this app's controlled vocabulary and OpenStreetMap tags.
 *
 * This module is pure and has no I/O. It is the single place where "does this
 * restaurant satisfy the user's dietary requirement" is decided, so it is
 * deliberately kept out of any LLM's reach and is the primary unit-test target.
 */

/** OSM values that count as a positive dietary claim. */
export const POSITIVE_DIET_VALUES = ["yes", "only"] as const;

/**
 * Each need maps to the OSM tags that can satisfy it. Multiple entries are
 * alternatives (OR) — the implications are factual, not heuristic: food that is
 * vegan is by definition also vegetarian and free of dairy.
 *
 * Needs absent from this table cannot be expressed in OSM at all. They must
 * never be silently dropped — see `partitionNeeds`.
 */
export const DIET_TAG_ALTERNATIVES: Record<string, string[]> = {
  vegan: ["diet:vegan"],
  vegetarian: ["diet:vegetarian", "diet:vegan"],
  "dairy-free": ["diet:lactose_free", "diet:vegan"],
  "gluten-free": ["diet:gluten_free"],
  halal: ["diet:halal"],
  kosher: ["diet:kosher"],
  // keto, paleo, nut-free: OSM has no tag for these.
};

/**
 * OSM `cuisine` values for each vocabulary term. Used to build the query regex
 * from a lookup table rather than from raw user text — which both fixes the
 * mismatches (OSM writes `middle_eastern`, not `middle eastern`) and removes
 * the query-injection surface entirely.
 */
export const CUISINE_OSM_VALUES: Record<string, string[]> = {
  italian: ["italian", "pizza", "pasta"],
  mexican: ["mexican", "tacos", "burrito", "tex-mex"],
  chinese: ["chinese", "dim_sum", "szechuan", "cantonese"],
  japanese: ["japanese", "sushi", "ramen", "teriyaki", "izakaya"],
  indian: ["indian", "curry", "tandoori", "punjabi", "south_indian"],
  thai: ["thai"],
  korean: ["korean", "korean_bbq"],
  mediterranean: [
    "mediterranean",
    "greek",
    "gyros",
    "falafel",
    "turkish",
    "lebanese",
  ],
  // `new_american` is genuinely American cuisine and is included deliberately.
  // `latin_american` is not, and is deliberately excluded — the old unanchored
  // substring regex matched both by accident.
  american: [
    "american",
    "new_american",
    "burger",
    "barbecue",
    "diner",
    "steak_house",
  ],
  french: ["french", "crepe", "bistro"],
  vietnamese: ["vietnamese", "pho", "banh_mi"],
  greek: ["greek", "gyros", "souvlaki"],
  "middle eastern": [
    "middle_eastern",
    "lebanese",
    "arab",
    "persian",
    "turkish",
    "falafel",
    "shawarma",
    "kebab",
  ],
  ethiopian: ["ethiopian", "eritrean"],
  caribbean: ["caribbean", "jamaican", "cuban"],
};

export interface NeedPartition {
  /** Needs OSM can express, and which are therefore hard-filtered. */
  enforceable: string[];
  /** Needs OSM has no tag for. Surfaced as warnings, never silently dropped. */
  unenforceable: string[];
}

export function partitionNeeds(needs: string[]): NeedPartition {
  const enforceable: string[] = [];
  const unenforceable: string[] = [];
  for (const need of needs) {
    if (DIET_TAG_ALTERNATIVES[need]) enforceable.push(need);
    else unenforceable.push(need);
  }
  return { enforceable, unenforceable };
}

/** True when `tags` carries a positive value for at least one alternative. */
export function satisfiesNeed(
  tags: Record<string, string>,
  need: string
): boolean {
  const alternatives = DIET_TAG_ALTERNATIVES[need];
  if (!alternatives) return false;
  return alternatives.some((tag) =>
    (POSITIVE_DIET_VALUES as readonly string[]).includes(tags[tag])
  );
}

/**
 * The hard safety predicate: every enforceable need must be positively
 * evidenced. Absence of a tag is never treated as a pass — "we don't know"
 * and "yes" are different answers, and only one of them is safe to show.
 */
export function matchesAllNeeds(
  tags: Record<string, string>,
  enforceableNeeds: string[]
): boolean {
  return enforceableNeeds.every((need) => satisfiesNeed(tags, need));
}

/**
 * Strength of the dietary evidence, 0..1. `only` (the whole establishment is
 * vegan) is stronger evidence than `yes` (some options are).
 */
export function dietTagStrength(
  tags: Record<string, string>,
  enforceableNeeds: string[]
): number {
  if (enforceableNeeds.length === 0) return 0;
  const perNeed: number[] = enforceableNeeds.map((need) => {
    const alternatives = DIET_TAG_ALTERNATIVES[need] ?? [];
    const values = alternatives.map((tag) => tags[tag]).filter(Boolean);
    if (values.includes("only")) return 1;
    if (values.includes("yes")) return 0.8;
    return 0;
  });
  return perNeed.reduce((sum, v) => sum + v, 0) / perNeed.length;
}

/** The diet:* tags actually present, for display and evidence. */
export function extractDietTags(
  tags: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key.startsWith("diet:")) out[key] = value;
  }
  return out;
}

/** Escapes a literal for safe inclusion in an Overpass regex. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

/**
 * Overpass tag filters for one need, as alternatives. Returns one filter string
 * per alternative tag; the caller decides how to combine them.
 */
export function dietFiltersForNeed(need: string): string[] {
  const alternatives = DIET_TAG_ALTERNATIVES[need] ?? [];
  return alternatives.map(
    (tag) => `["${tag}"~"^(${POSITIVE_DIET_VALUES.join("|")})$"]`
  );
}

/**
 * An anchored Overpass regex filter for a cuisine term. OSM stores multiple
 * cuisines semicolon-separated (`cuisine=japanese;ramen`), so alternatives are
 * anchored to `;` or string boundaries rather than matched as substrings.
 */
export function cuisineFilter(cuisineType: string): string | null {
  const values = CUISINE_OSM_VALUES[cuisineType];
  if (!values?.length) return null;
  const alternation = values.map(escapeRegex).join("|");
  return `["cuisine"~"(^|;)[ ]*(${alternation})[ ]*($|;)",i]`;
}

/** True when a restaurant's parsed cuisine list matches the requested term. */
export function cuisineMatches(
  cuisines: string[],
  cuisineType: string | undefined
): boolean {
  if (!cuisineType) return false;
  const values = CUISINE_OSM_VALUES[cuisineType];
  if (!values?.length) return false;
  return cuisines.some((c) => values.includes(c.trim().toLowerCase()));
}
