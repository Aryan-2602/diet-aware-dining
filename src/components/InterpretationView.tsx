"use client";

/**
 * In-flight search animation. `currentAgent` is advanced by delays in
 * `page.tsx`, not by streamed pipeline events — the API is one blocking POST.
 * Meal type and price are not shown: neither is applied to the Overpass query.
 */
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
    // Kept because page.tsx still steps through this id — dropping it would
    // make currentIdx -1 for that tick and reset the whole stepper. The copy no
    // longer says "preparing results for export", which implied a download
    // button that does not exist.
    id: "export",
    label: "Export Agent",
    description: "Serializing results...",
  },
  {
    id: "recommendation",
    label: "Recommendation Agent",
    description: "Ranking and finalizing results...",
  },
];

/** Stepper UI; highlight is `currentAgent` from the parent, not live agent status. */
export function InterpretationView({ currentAgent }: InterpretationViewProps) {
  // Deliberately NOT reading parsedIntent from the store. It is only written by
  // setResults, i.e. after this screen has been dismissed, so rendering it here
  // showed nothing on a first search and the *previous* query's needs and
  // location on every search after that.

  const currentIdx = AGENT_STEPS.findIndex((a) => a.id === currentAgent);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
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
