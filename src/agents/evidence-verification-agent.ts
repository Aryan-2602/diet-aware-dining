import { Evidence, ParsedIntent, Restaurant } from "@/types";
import { DIET_TAG_ALTERNATIVES } from "@/lib/tools/diet-tags";
import { recencyScore } from "@/lib/confidence-scorer";

/**
 * Evidence Verification Agent
 *
 * Each Evidence item is a literal restatement of an OpenStreetMap tag. The
 * previous implementation hardcoded `confidence: 0.75, verified: true,
 * menuConfirmed: true` for every dietary option a place had — including options
 * the user never asked for — and asserted that a diet tag "is essentially a menu
 * confirmation", which is not true. A tag says someone once recorded a claim; it
 * does not say a menu was inspected.
 *
 * The split that matters: whether the tag exists is a fact (`verified`), while
 * whether it is still accurate is a belief derived from its check date
 * (`confidence`). Both are computed in code — an LLM has no business asserting
 * either.
 */
export class EvidenceVerificationAgent {
  async process(
    restaurants: Restaurant[],
    intent: ParsedIntent,
    enforceableNeeds: string[],
    unenforceableNeeds: string[]
  ): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    for (const restaurant of restaurants) {
      const belief = recencyScore(restaurant.lastCheckedISO);

      // One item per requested need that OSM can express, quoting the tag.
      for (const need of enforceableNeeds) {
        const tag = this.matchingTag(restaurant, need);
        if (!tag) continue;
        evidence.push({
          restaurantId: restaurant.id,
          claim: `OpenStreetMap tag ${tag.key}=${tag.value}`,
          verified: true,
          // A tag with no check date is still a real tag, so this floors at a
          // low positive rather than zero.
          confidence: Math.max(0.4, belief),
          menuConfirmed: false,
        });
      }

      // And one per need OSM cannot express, so the gap is stated rather than
      // quietly omitted.
      for (const need of unenforceableNeeds) {
        evidence.push({
          restaurantId: restaurant.id,
          claim: `OpenStreetMap has no data for "${need}" — it cannot be verified`,
          verified: false,
          confidence: 0,
          menuConfirmed: false,
        });
      }

      for (const allergy of intent.restrictions) {
        evidence.push({
          restaurantId: restaurant.id,
          claim: `OpenStreetMap holds no allergen or cross-contamination data, so "${allergy}" safety cannot be verified`,
          verified: false,
          confidence: 0,
          menuConfirmed: false,
        });
      }

      if (restaurant.lastCheckedISO) {
        evidence.push({
          restaurantId: restaurant.id,
          claim: `Listing last confirmed by a mapper on ${restaurant.lastCheckedISO}`,
          verified: true,
          confidence: belief,
          menuConfirmed: false,
        });
      }
    }

    return evidence;
  }

  /** The specific tag satisfying a need, for quoting verbatim. */
  private matchingTag(
    restaurant: Restaurant,
    need: string
  ): { key: string; value: string } | null {
    for (const key of DIET_TAG_ALTERNATIVES[need] ?? []) {
      const value = restaurant.dietTags[key];
      if (value === "yes" || value === "only") return { key, value };
    }
    return null;
  }
}
