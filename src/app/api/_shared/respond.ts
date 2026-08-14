import { NextResponse } from "next/server";
import type { AgentPipeline } from "@/agents/pipeline";

/**
 * Turns a finished pipeline run into an HTTP response.
 *
 * The point of this file is that a run has four distinct outcomes and they used
 * to collapse into one. Previously the route only checked for
 * `awaiting_clarification`; a geocode miss, an Overpass outage, a rate limit and
 * a genuinely empty result set all fell through to HTTP 200 with
 * `status: "complete"` and zero recommendations, so the UI rendered "No
 * restaurants found — try broadening your search" for every one of them.
 */

/** Upstream service problems the user can only wait out. */
const UPSTREAM_CODES = new Set([
  "geocode_unavailable",
  "overpass_unavailable",
  "overpass_timeout",
]);

export function respondWithPipeline(pipeline: AgentPipeline) {
  const state = pipeline.getState();
  const meta = pipeline.getMeta();

  if (state.status === "awaiting_clarification") {
    return NextResponse.json({
      status: "awaiting_clarification",
      clarificationNeeded: state.clarificationNeeded,
      parsedIntent: state.parsedIntent,
    });
  }

  if (state.status === "error") {
    const code = pipeline.getErrorCode() ?? "internal";
    const status = code === "geocode_failed" ? 422 : UPSTREAM_CODES.has(code) ? 503 : 500;
    return NextResponse.json(
      {
        status: "error",
        code,
        message: state.error ?? "Something went wrong",
        parsedIntent: state.parsedIntent,
      },
      { status }
    );
  }

  // A real, honest zero: the search ran and nothing satisfied the requirement.
  if (state.recommendations.length === 0) {
    return NextResponse.json({
      status: "no_matches",
      recommendations: [],
      parsedIntent: state.parsedIntent,
      meta,
    });
  }

  return NextResponse.json({
    status: "complete",
    recommendations: state.recommendations,
    parsedIntent: state.parsedIntent,
    mapData: state.mapData,
    meta,
    metadata: {
      // Counts now describe the set actually shown, rather than mixing in
      // candidates that were discarded before display.
      totalFound: state.recommendations.length,
      candidatesScanned: meta?.candidatesScanned ?? 0,
      verified: state.evidence.filter((e) => e.verified).length,
      avgConfidence:
        state.confidenceScores.length > 0
          ? Math.round(
              (state.confidenceScores.reduce((sum, s) => sum + s.overall, 0) /
                state.confidenceScores.length) *
                100
            ) / 100
          : 0,
    },
  });
}
