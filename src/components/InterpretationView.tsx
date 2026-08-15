"use client";

/**
 * In-flight search state.
 *
 * This used to be a seven-step stepper whose highlight was advanced by
 * `setTimeout` in page.tsx: two steps before the request was even sent, then
 * five more animated *after* the response had already arrived and been parsed.
 * The API is one blocking POST with no progress events, so the stepper spent
 * most of a real 10-40s search frozen on one row and then flickered through
 * five stages describing work that was already finished.
 *
 * Showing a progress indicator that measures nothing is the same category of
 * problem as the fabricated ratings this codebase already removed. So what is
 * left is what can actually be known: that a request is in flight, where it is
 * looking, and how long it has been going.
 *
 * The pipeline steps survive as an explanation of what a search does, clearly
 * separated from any claim about where it currently is.
 */
import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const PIPELINE_STEPS = [
  "Parse dietary needs, cuisine and location from your request",
  "Resolve the location to coordinates",
  "Query OpenStreetMap for places tagged with the matching diet:* keys",
  "Re-check every returned place against your requirements",
  "Score by tag strength, coverage, recency and listing detail",
];

export function InterpretationView({
  location,
  onCancel,
}: {
  /** Shown so the status line names a real thing, not a generic spinner. */
  location?: string;
  onCancel?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-gray-900">
              {location
                ? `Searching OpenStreetMap near ${location}`
                : "Searching OpenStreetMap"}
            </h1>
            {/* Elapsed time is real information, and it does the job the fake
                stepper was doing -- showing the app is alive. */}
            <p
              role="status"
              aria-live="polite"
              className="mt-1 text-sm text-gray-600"
            >
              <span className="tabular-nums">{elapsed}s</span> elapsed · most
              searches take 10–40 seconds
            </p>
          </div>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>

        {/* Indeterminate, because the duration genuinely is not known. The
            global reduced-motion rule stops the animation for users who ask. */}
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full w-1/3 animate-[loading_1.4s_ease-in-out_infinite] rounded-full bg-gray-900" />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-gray-900">
          What this search does
        </h2>
        {/* Deliberately unhighlighted: this explains the pipeline, it does not
            claim to track it. */}
        <ol className="mt-3 space-y-2">
          {PIPELINE_STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm text-gray-600">
              <span className="w-4 shrink-0 tabular-nums text-gray-400">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
