"use client";

/**
 * Root client page — a Zustand-driven SPA, not a Next.js multi-route app.
 *
 * Screens swap via `currentPage` in the store. There is no `/results` URL;
 * a refresh always lands on "landing". Search is one blocking POST to the
 * Python API; the agent-step delays below are cosmetic so InterpretationView
 * can animate while that call is in flight (or after it returns).
 */

import { useState } from "react";
import { useAppStore } from "@/store";
import { LandingPage } from "@/components/LandingPage";
import { SearchForm } from "@/components/SearchForm";
import { ClarificationDialog } from "@/components/ClarificationDialog";
import { InterpretationView } from "@/components/InterpretationView";
import { ResultsMapView } from "@/components/ResultsMapView";
import { RestaurantDetails } from "@/components/RestaurantDetails";
import { EvidenceView } from "@/components/EvidenceView";
import { SavedRecentView } from "@/components/SavedRecentView";
import { Navigation } from "@/components/Navigation";
import {
  AgentName,
  ClarificationQuestion,
  DietaryRequest,
} from "@/types";

/** Local UI state for the in-flight search; results themselves live in the store. */
type ProcessingState =
  | { phase: "idle" }
  | { phase: "processing"; currentAgent: AgentName }
  | {
      phase: "clarification";
      questions: ClarificationQuestion[];
      originalRequest: DietaryRequest;
    }
  | { phase: "error"; message: string };

export default function Home() {
  const currentPage = useAppStore((s) => s.currentPage);
  const setPage = useAppStore((s) => s.setPage);
  const setResults = useAppStore((s) => s.setResults);
  const addRecentSearch = useAppStore((s) => s.addRecentSearch);

  const [processingState, setProcessingState] = useState<ProcessingState>({
    phase: "idle",
  });
  const [isLoading, setIsLoading] = useState(false);

  /**
   * POST `/api/recommend`. Status branches:
   * - `awaiting_clarification` → ClarificationDialog on the search screen
   * - `complete` → store results, go to the map
   * - `no_matches` → still a result (empty set with searchMeta), not an error
   * - anything else / network failure → error banner on search
   */
  const handleSearch = async (data: {
    query: string;
    location: string;
    dietaryPreferences: string[];
    allergies: string[];
    cuisinePreferences: string[];
  }) => {
    setIsLoading(true);
    setPage("interpretation");
    setProcessingState({ phase: "processing", currentAgent: "dietary_intent" });

    try {
      const request: DietaryRequest = {
        query: data.query,
        location: data.location,
        dietaryPreferences: data.dietaryPreferences,
        allergies: data.allergies,
        cuisinePreferences: data.cuisinePreferences,
      };

      // Cosmetic: the pipeline is a single POST. These delays only drive the
      // InterpretationView stepper so the user sees "intent" then "discovery"
      // before the response arrives.
      const earlyAgents: AgentName[] = ["dietary_intent", "restaurant_discovery"];
      for (const agent of earlyAgents) {
        setProcessingState({ phase: "processing", currentAgent: agent });
        await delay(600);
      }

      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const result = await response.json();

      if (result.status === "awaiting_clarification") {
        setProcessingState({
          phase: "clarification",
          questions: result.clarificationNeeded,
          originalRequest: request,
        });
        setPage("search");
      } else if (result.status === "complete") {
        // Remaining steps animate after the API returns — the work is already done.
        const lateAgents: AgentName[] = [
          "evidence_verification",
          "trust_confidence",
          "map_generation",
          "export",
          "recommendation",
        ];
        for (const agent of lateAgents) {
          setProcessingState({ phase: "processing", currentAgent: agent });
          await delay(300);
        }

        setResults(
          result.recommendations,
          result.mapData || null,
          result.parsedIntent || null,
          result.metadata,
          result.meta
        );
        addRecentSearch(request, result.recommendations.length);
        setProcessingState({ phase: "idle" });
        setPage("results");
      } else if (result.status === "no_matches") {
        // The search ran and genuinely found nothing. That is a result, not an
        // error — show the results page so it can explain what was searched.
        setResults([], null, result.parsedIntent || null, null, result.meta);
        addRecentSearch(request, 0);
        setProcessingState({ phase: "idle" });
        setPage("results");
      } else {
        setProcessingState({
          phase: "error",
          message: result.message || "Something went wrong",
        });
        // The error banner only renders on the search page; without this the
        // user was left on a blank interpretation screen with no message.
        setPage("search");
      }
    } catch {
      setProcessingState({
        phase: "error",
        message: "Failed to connect to the server",
      });
      setPage("search");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Resume after ClarificationDialog. `/api/clarify` re-runs the full pipeline
   * with the merged request; it does not resume an in-memory AgentPipeline.
   */
  const handleClarification = async (answers: Record<string, string>) => {
    if (processingState.phase !== "clarification") return;

    setIsLoading(true);
    setPage("interpretation");
    setProcessingState({ phase: "processing", currentAgent: "restaurant_discovery" });

    try {
      const response = await fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalRequest: processingState.originalRequest,
          answers,
        }),
      });

      const result = await response.json();

      // A clarified location can still be ambiguous, in which case the answer
      // is another question — not a completed search. This branch did not exist,
      // so the response fell through and `undefined` was written to the store.
      if (result.status === "awaiting_clarification") {
        setProcessingState({
          phase: "clarification",
          questions: result.clarificationNeeded,
          originalRequest: processingState.originalRequest,
        });
        setPage("search");
        return;
      }

      if (result.status === "error") {
        setProcessingState({
          phase: "error",
          message: result.message || "Something went wrong",
        });
        setPage("search");
        return;
      }

      const remainingAgents: AgentName[] = [
        "evidence_verification",
        "trust_confidence",
        "map_generation",
        "export",
        "recommendation",
      ];
      for (const agent of remainingAgents) {
        setProcessingState({ phase: "processing", currentAgent: agent });
        await delay(300);
      }

      const recommendations = Array.isArray(result.recommendations)
        ? result.recommendations
        : [];
      setResults(
        recommendations,
        result.mapData || null,
        result.parsedIntent || null,
        result.metadata,
        result.meta
      );
      addRecentSearch(processingState.originalRequest, recommendations.length);
      setProcessingState({ phase: "idle" });
      setPage("results");
    } catch {
      setProcessingState({
        phase: "error",
        message: "Failed to process clarification",
      });
      setPage("search");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-primary-500 text-xl">📍</span>
            <span className="text-xl font-bold text-gray-900">Dietary Maps AI</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <NavLink active={currentPage === "landing"} onClick={() => setPage("landing")}>Home</NavLink>
            <NavLink active={currentPage === "search"} onClick={() => setPage("search")}>Search</NavLink>
            <NavLink active={currentPage === "results"} onClick={() => setPage("results")}>Results</NavLink>
            <NavLink active={currentPage === "evidence"} onClick={() => setPage("evidence")}>Evidence</NavLink>
            <NavLink active={currentPage === "saved"} onClick={() => setPage("saved")}>Saved</NavLink>
          </nav>
          <button
            onClick={() => setPage("search")}
            className="px-5 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-full transition-colors"
          >
            Search Now
          </button>
        </div>
      </header>

      {/* Page Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentPage === "landing" && <LandingPage />}

        {currentPage === "search" && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-gray-900">
                What are you craving?
              </h1>
              <p className="text-gray-500 mt-1">
                Describe your dietary needs in plain language
              </p>
            </div>

            {processingState.phase === "clarification" ? (
              <ClarificationDialog
                questions={processingState.questions}
                onSubmit={handleClarification}
              />
            ) : (
              <SearchForm onSubmit={handleSearch} isLoading={isLoading} />
            )}

            {processingState.phase === "error" && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
                {processingState.message}
              </div>
            )}
          </div>
        )}

        {currentPage === "interpretation" &&
          processingState.phase === "processing" && (
            <InterpretationView currentAgent={processingState.currentAgent} />
          )}

        {currentPage === "results" && <ResultsMapView />}

        {currentPage === "details" && <RestaurantDetails />}

        {currentPage === "evidence" && <EvidenceView />}

        {currentPage === "saved" && <SavedRecentView />}
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-primary-500">📍</span>
                <span className="text-lg font-bold text-white">Dietary Maps AI</span>
              </div>
              <p className="text-sm">
                Discover restaurants that match your complex dietary needs — powered by AI, navigated with Google Maps.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-200 mb-3">Navigation</h4>
              <div className="space-y-2 text-sm">
                <button onClick={() => setPage("landing")} className="block hover:text-white transition-colors">Home</button>
                <button onClick={() => setPage("search")} className="block hover:text-white transition-colors">Search</button>
                <button onClick={() => setPage("results")} className="block hover:text-white transition-colors">Results Map</button>
                <button onClick={() => setPage("evidence")} className="block hover:text-white transition-colors">Evidence & Trust</button>
                <button onClick={() => setPage("saved")} className="block hover:text-white transition-colors">Saved & Recent</button>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-200 mb-3">Data Sources</h4>
              <div className="space-y-2 text-sm">
                <p>OpenStreetMap via Overpass API</p>
                <p>Nominatim Geocoding</p>
                <p>Community-verified dietary tags</p>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-700 mt-8 pt-6 text-xs text-center text-gray-500">
            © 2024 Dietary Maps AI. Data from OpenStreetMap contributors.
          </div>
        </div>
      </footer>

      {/* Mobile Navigation (hidden on desktop) */}
      <div className="md:hidden">
        <Navigation />
      </div>
    </div>
  );
}

/** Desktop header link; active state comes from Zustand, not the URL. */
function NavLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm font-medium transition-colors ${
        active ? "text-primary-600" : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}

/** Used only to pace the interpretation stepper — not a real agent wait. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
