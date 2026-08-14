import {
  ConfidenceScore,
  Evidence,
  ParsedIntent,
  Recommendation,
  Restaurant,
} from "@/types";
import { callLLM, LLMUnavailableError, parseJSONResponse } from "@/lib/llm-client";
import { cuisineMatches, matchesAllNeeds } from "@/lib/tools/diet-tags";

/**
 * Recommendation Agent
 *
 * Ranking is deterministic; only the prose is generated. The previous version
 * mapped every restaurant 1:1 into a recommendation with no filter at all, so a
 * place with no dietary tags could be returned at rank #1 for a vegan search
 * with nothing more than a missing "match reason" to hint at it.
 *
 * The dietary filter is applied here for the third time — the Overpass query
 * filters, the discovery agent re-asserts, and this is the last gate before a
 * result reaches a person. Cheap, and it means no future refactor of the layers
 * above can quietly surface an unverified match.
 */

interface LLMCopy {
  [restaurantId: string]:
    | { matchReasons?: unknown; warnings?: unknown }
    | undefined;
}

export class RecommendationAgent {
  async process(
    restaurants: Restaurant[],
    scores: ConfidenceScore[],
    evidence: Evidence[],
    intent: ParsedIntent,
    enforceableNeeds: string[],
    unenforceableNeeds: string[]
  ): Promise<Recommendation[]> {
    const safe = restaurants.filter((r) =>
      matchesAllNeeds(r.dietTags, enforceableNeeds)
    );

    const ranked = safe
      .map((restaurant) => ({
        restaurant,
        confidence: this.scoreFor(scores, restaurant.id),
        evidence: evidence.filter((e) => e.restaurantId === restaurant.id),
      }))
      .sort((a, b) => {
        // When allergies are in play, a place we can phone is materially more
        // useful than one we cannot, because calling ahead is the only real
        // verification available.
        if (intent.restrictions.length > 0) {
          const aCallable = a.restaurant.phone ? 0 : 1;
          const bCallable = b.restaurant.phone ? 0 : 1;
          if (aCallable !== bCallable) return aCallable - bCallable;
        }
        return b.confidence.overall - a.confidence.overall;
      });

    const copy = await this.writeCopy(ranked, intent, unenforceableNeeds);

    return ranked.map(({ restaurant, confidence, evidence: items }) => ({
      restaurant,
      confidence,
      evidence: items,
      matchReasons:
        copy[restaurant.id]?.matchReasons ??
        this.fallbackReasons(restaurant, intent, enforceableNeeds),
      // Warnings are always computed in code and merged, never left to the
      // model — a dropped safety caveat is not an acceptable failure mode.
      warnings: [
        ...this.mandatoryWarnings(restaurant, intent, unenforceableNeeds),
        ...(copy[restaurant.id]?.warnings ?? []),
      ],
    }));
  }

  private scoreFor(scores: ConfidenceScore[], id: string): ConfidenceScore {
    return (
      scores.find((s) => s.restaurantId === id) ?? {
        restaurantId: id,
        overall: 0,
        dietTagStrength: 0,
        coverage: 0,
        tagRecency: 0,
        dataCompleteness: 0,
      }
    );
  }

  /** LLM writes the human-facing reasons. Falls back to templates. */
  private async writeCopy(
    ranked: Array<{ restaurant: Restaurant; confidence: ConfidenceScore }>,
    intent: ParsedIntent,
    unenforceableNeeds: string[]
  ): Promise<Record<string, { matchReasons?: string[]; warnings?: string[] }>> {
    if (ranked.length === 0) return {};

    const system = [
      "You write short, factual explanations for restaurant recommendations.",
      "Return ONLY a JSON object keyed by restaurant id:",
      '{ "<id>": { "matchReasons": string[], "warnings": string[] } }',
      "",
      "Rules:",
      "- Every statement must be supported by the OpenStreetMap tags provided.",
      "- Never claim a menu was checked, a dish is available, or that a place is",
      "  safe for an allergy. OpenStreetMap contains none of that information.",
      "- 1-2 short match reasons each. Use [] for warnings if you have nothing",
      "  factual to add; safety caveats are added separately.",
      "- Do not mention prices, ratings or reviews: there is no such data.",
    ].join("\n");

    const payload = ranked.slice(0, 10).map(({ restaurant, confidence }) => ({
      id: restaurant.id,
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      dietTags: restaurant.dietTags,
      distanceM: restaurant.distance,
      lastChecked: restaurant.lastCheckedISO ?? null,
      verificationStrength: confidence.overall,
    }));

    const user = [
      `Diner asked for: ${intent.dietaryNeeds.join(", ") || "no dietary requirement"}`,
      `Cuisine preference: ${intent.cuisineType ?? "none"}`,
      `Cannot be verified from OpenStreetMap: ${
        unenforceableNeeds.join(", ") || "nothing"
      }`,
      `Restaurants: ${JSON.stringify(payload)}`,
    ].join("\n");

    try {
      const raw = await callLLM({ system, user, maxTokens: 900, jsonMode: true });
      const parsed = parseJSONResponse<LLMCopy>(raw);
      const out: Record<string, { matchReasons?: string[]; warnings?: string[] }> =
        {};
      for (const [id, value] of Object.entries(parsed ?? {})) {
        out[id] = {
          matchReasons: this.stringList(value?.matchReasons),
          warnings: this.stringList(value?.warnings),
        };
      }
      return out;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof LLMUnavailableError)) throw error;
      console.warn(
        `[RecommendationAgent] copy generation unavailable, using templates: ${message}`
      );
      return {};
    }
  }

  private stringList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    );
    return items.length > 0 ? items : undefined;
  }

  private fallbackReasons(
    restaurant: Restaurant,
    intent: ParsedIntent,
    enforceableNeeds: string[]
  ): string[] {
    const reasons: string[] = [];

    for (const need of enforceableNeeds) {
      const tag = Object.entries(restaurant.dietTags).find(
        ([, value]) => value === "only" || value === "yes"
      );
      if (tag) {
        reasons.push(
          tag[1] === "only"
            ? `Entirely ${need} according to OpenStreetMap (${tag[0]}=only)`
            : `Tagged ${need} in OpenStreetMap (${tag[0]}=yes)`
        );
        break;
      }
    }

    if (cuisineMatches(restaurant.cuisine, intent.cuisineType)) {
      reasons.push(`Serves ${intent.cuisineType} cuisine`);
    }
    if (typeof restaurant.distance === "number") {
      reasons.push(`${(restaurant.distance / 1000).toFixed(1)} km away`);
    }
    return reasons;
  }

  /** Non-negotiable caveats, always present regardless of what the LLM wrote. */
  private mandatoryWarnings(
    restaurant: Restaurant,
    intent: ParsedIntent,
    unenforceableNeeds: string[]
  ): string[] {
    const warnings: string[] = [];

    if (intent.restrictions.length > 0) {
      warnings.push(
        `OpenStreetMap has no allergen or cross-contamination data. Tell staff about your ${intent.restrictions.join(
          " and "
        )} allergy before ordering${restaurant.phone ? ` — call ${restaurant.phone}` : ""}.`
      );
    }

    for (const need of unenforceableNeeds) {
      warnings.push(
        `OpenStreetMap cannot confirm "${need}" — no such tag exists. Check directly.`
      );
    }

    if (!restaurant.lastCheckedISO) {
      warnings.push(
        "No mapper has recorded when this listing was last confirmed."
      );
    }

    return warnings;
  }
}
