"use client";

/**
 * In-flight search animation. `currentAgent` is advanced by delays in
 * `page.tsx`, not by streamed pipeline events — the API is one blocking POST.
 * Meal type and price are not shown: neither is applied to the Overpass query.
 */
import { useAppStore } from "@/store";
import { AgentName } from "@/types";

interface InterpretationViewProps {
  currentAgent: AgentName;
}

const AGENT_STEPS: {
  id: AgentName;
  label: string;
  description: string;
}[] = [
  {
    id: "dietary_intent",
    label: "Dietary Intent Agent",
    description: "Parsing dietary needs, restrictions, cuisine, location...",
  },
  {
    id: "clarification",
    label: "Clarification Agent",
    description: "Checking for ambiguities...",
  },
  {
    id: "restaurant_discovery",
    label: "Restaurant Discovery Agent",
    description: "Searching OpenStreetMap via the Overpass API...",
  },
  {
    id: "evidence_verification",
    label: "Evidence Verification Agent",
    description: "Checking diet:* tags against your requirements...",
  },
  {
    id: "trust_confidence",
    label: "Trust & Confidence Agent",
    description: "Calculating confidence scores...",
  },
  {
    id: "map_generation",
    label: "Map Generation Agent",
    description: "Building map view with markers...",
  },
  {
    id: "export",
    label: "Export Agent",
    description: "Preparing results for export...",
  },
  {
    id: "recommendation",
    label: "Recommendation Agent",
    description: "Ranking and finalizing results...",
  },
];

/** Stepper UI; highlight is `currentAgent` from the parent, not live agent status. */
export function InterpretationView({ currentAgent }: InterpretationViewProps) {
  const parsedIntent = useAppStore((s) => s.parsedIntent);

  const currentIdx = AGENT_STEPS.findIndex((a) => a.id === currentAgent);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Parsed Intent Display */}
      {parsedIntent && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
            AI Query Interpretation
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {parsedIntent.dietaryNeeds.length > 0 && (
              <div>
                <span className="text-gray-500">Dietary Needs:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {parsedIntent.dietaryNeeds.map((need) => (
                    <span
                      key={need}
                      className="px-2 py-0.5 bg-primary-50 text-primary-700 rounded-full text-xs font-medium"
                    >
                      {need}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {parsedIntent.location && (
              <div>
                <span className="text-gray-500">Location:</span>
                <p className="font-medium text-gray-900 mt-1">
                  {parsedIntent.location}
                </p>
              </div>
            )}
            {parsedIntent.cuisineType && (
              <div>
                <span className="text-gray-500">Cuisine:</span>
                <p className="font-medium text-gray-900 mt-1 capitalize">
                  {parsedIntent.cuisineType}
                </p>
              </div>
            )}
            {/* Meal type and price range are deliberately not shown. Neither
                reaches the search: opening_hours parsing is not implemented and
                OpenStreetMap has no price data. Displaying them alongside the
                filters that DO apply implied they were being honoured. */}
            {parsedIntent.restrictions.length > 0 && (
              <div>
                <span className="text-gray-500">Restrictions:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {parsedIntent.restrictions.map((r) => (
                    <span
                      key={r}
                      className="px-2 py-0.5 bg-red-50 text-red-700 rounded-full text-xs font-medium"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Progress */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
          Search Progress
        </h3>
        <div className="space-y-2">
          {AGENT_STEPS.map((step, index) => {
            const isActive = step.id === currentAgent;
            const isPast = index < currentIdx;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                  isActive ? "bg-primary-50" : ""
                }`}
              >
                <div className="flex-shrink-0">
                  {isPast ? (
                    <div className="w-6 h-6 rounded-full bg-primary-500 flex items-center justify-center">
                      <svg
                        className="w-4 h-4 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  ) : isActive ? (
                    <div className="w-6 h-6 rounded-full border-2 border-primary-500 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-gray-200" />
                  )}
                </div>
                <div>
                  <p
                    className={`text-sm font-medium ${
                      isActive
                        ? "text-primary-700"
                        : isPast
                        ? "text-gray-600"
                        : "text-gray-400"
                    }`}
                  >
                    {step.label}
                  </p>
                  {isActive && (
                    <p className="text-xs text-primary-600">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
