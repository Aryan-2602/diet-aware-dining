/**
 * Confidence thresholds, written down once.
 *
 * These used to live inline in two components, in two different scales, which
 * meant the boundary between "high confidence" and "moderate" could drift
 * between the results card and the details screen without anyone noticing.
 *
 * Note that there are deliberately **two** sets rather than one. They measure
 * different things: `CONFIDENCE_TIERS` grades a restaurant's overall match,
 * while `EVIDENCE_TIERS` grades how recently a single OSM tag was confirmed.
 * Collapsing them into a shared constant would look tidier and would silently
 * change what the user is told about an individual claim. The goal here is
 * that each number is written down once, not that they become equal.
 */

/** Applied to `ConfidenceScore.overall` (0-1). */
export const CONFIDENCE_TIERS = { high: 0.85, medium: 0.7 } as const;

/** Applied to `Evidence.confidence` (0-1) -- belief the tag is still accurate. */
export const EVIDENCE_TIERS = { high: 0.7, medium: 0.5 } as const;

export type Tier = "high" | "medium" | "low";

/** Tone for the `Badge` / `Alert` primitives, so a tier always looks the same. */
export const TIER_TONE = {
  high: "verified",
  medium: "caution",
  low: "neutral",
} as const;

/**
 * Read aloud next to the number. A bare percentage is not interpretable --
 * nothing on screen says whether 77% is good.
 */
export const TIER_LABEL: Record<Tier, string> = {
  high: "High confidence",
  medium: "Moderate confidence",
  low: "Low confidence",
};

export function confidenceTier(overall: number): Tier {
  if (overall >= CONFIDENCE_TIERS.high) return "high";
  if (overall >= CONFIDENCE_TIERS.medium) return "medium";
  return "low";
}

export function evidenceTier(confidence: number): Tier {
  if (confidence >= EVIDENCE_TIERS.high) return "high";
  if (confidence >= EVIDENCE_TIERS.medium) return "medium";
  return "low";
}
