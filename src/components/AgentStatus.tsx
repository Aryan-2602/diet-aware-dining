"use client";

/**
 * Unused. Superseded by InterpretationView. Not imported from page.tsx.
 * Copy still mentions Yelp/Google/Reddit — the live pipeline uses OSM only.
 */
import { AgentName } from "@/types";

interface AgentStatusProps {
  currentAgent: AgentName | null;
  status: string;
}

const AGENT_LABELS: Record<AgentName, { label: string; description: string }> = {
  dietary_intent: {
    label: "Dietary Intent Agent",
    description: "Parsing your preferences...",
  },
  clarification: {
    label: "Clarification Agent",
    description: "Resolving ambiguities...",
  },
  restaurant_discovery: {
    label: "Restaurant Discovery Agent",
    description: "Searching Yelp, Google, Reddit...",
  },
  evidence_verification: {
    label: "Evidence Verification Agent",
    description: "Verifying dietary claims...",
  },
  trust_confidence: {
    label: "Trust & Confidence Agent",
    description: "Scoring reliability...",
  },
  map_generation: {
    label: "Map Generation Agent",
    description: "Building map view...",
  },
  export: {
    label: "Export Agent",
    description: "Preparing results...",
  },
  recommendation: {
    label: "Recommendation Agent",
    description: "Ranking restaurants...",
  },
};

const AGENT_ORDER: AgentName[] = [
  "dietary_intent",
  "clarification",
  "restaurant_discovery",
  "evidence_verification",
  "trust_confidence",
  "recommendation",
];

/** Legacy pipeline stepper — not wired into page.tsx. */
export function AgentStatus({ currentAgent, status }: AgentStatusProps) {
  if (status === "idle" || status === "complete") return null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wide">
          Agent Pipeline
        </h3>
        <div className="space-y-3">
          {AGENT_ORDER.map((agent) => {
            const info = AGENT_LABELS[agent];
            const isActive = currentAgent === agent;
            const isPast =
              currentAgent &&
              AGENT_ORDER.indexOf(agent) < AGENT_ORDER.indexOf(currentAgent);

            return (
              <div
                key={agent}
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
                        ? "text-gray-500"
                        : "text-gray-400"
                    }`}
                  >
                    {info.label}
                  </p>
                  {isActive && (
                    <p className="text-xs text-primary-600">
                      {info.description}
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
