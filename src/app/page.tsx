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
import { SavedRecentView } from "@/components/SavedRecentView";
import { Navigation } from "@/components/Navigation";
import { cn } from "@/lib/cn";
import { ExternalIcon, ICON_MD, ICON_SM, LocationIcon, iconProps } from "@/lib/icons";
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
  const searchSeed = useAppStore((s) => s.searchSeed);
  const setSearchSeed = useAppStore((s) => s.setSearchSeed);
  const clearResults = useAppStore((s) => s.clearResults);
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
    setSearchSeed(null);
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
        clearResults();
        setProcessingState({
          phase: "error",
          message: result.message || "Something went wrong",
        });
        // The error banner only renders on the search page; without this the
        // user was left on a blank interpretation screen with no message.
        setPage("search");
      }
    } catch {
      clearResults();
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
        clearResults();
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
      clearResults();
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
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <LocationIcon size={ICON_MD} className="text-gray-900" {...iconProps} />
            <span className="text-[15px] font-semibold tracking-tight text-gray-900">
              Dietary Maps AI
            </span>
          </div>
          <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
            <NavLink active={currentPage === "landing"} onClick={() => setPage("landing")}>Home</NavLink>
            <NavLink active={currentPage === "search"} onClick={() => setPage("search")}>Search</NavLink>
            <NavLink active={currentPage === "results"} onClick={() => setPage("results")}>Results</NavLink>
            <NavLink active={currentPage === "saved"} onClick={() => setPage("saved")}>Saved</NavLink>
          </nav>
        </div>
      </header>

      {/* Page Content */}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 md:pb-8 lg:px-8"
      >
        {currentPage === "landing" && <LandingPage />}

        {currentPage === "search" && (
          <div className="max-w-3xl mx-auto">
            {/* The subhead restated the textarea placeholder verbatim. */}
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              What are you craving?
            </h1>

            {processingState.phase === "clarification" ? (
              <ClarificationDialog
                questions={processingState.questions}
                onSubmit={handleClarification}
                // Without this the dialog was inescapable: it replaces the
                // search form, and the processing state was never reset, so
                // navigating away and back brought it straight back.
                onCancel={() => setProcessingState({ phase: "idle" })}
              />
            ) : (
              <SearchForm
                key={searchSeed?.query ?? "blank"}
                onSubmit={handleSearch}
                isLoading={isLoading}
                initial={searchSeed ?? undefined}
              />
            )}

            {processingState.phase === "error" && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
                {processingState.message}
              </div>
            )}
          </div>
        )}

        {currentPage === "interpretation" &&
          (processingState.phase === "processing" ? (
            <InterpretationView currentAgent={processingState.currentAgent} />
          ) : (
            // Without this branch, any state where the page is "interpretation"
            // but processing has ended renders an empty <main> between the
            // header and footer. Today React batching usually hides it.
            <div className="text-center py-20">
              <p className="text-gray-500 mb-4">Nothing is running right now.</p>
              <button
                onClick={() => setPage("search")}
                className="px-6 py-2.5 text-primary-600 font-semibold hover:bg-primary-50 rounded-full transition-colors border border-primary-200"
              >
                Start a search
              </button>
            </div>
          ))}

        {currentPage === "results" && <ResultsMapView />}

        {currentPage === "details" && <RestaurantDetails />}

        {currentPage === "saved" && <SavedRecentView />}
      </main>

      {/* One footer for every screen.
          The dark marketing variant that used to render on the landing page was
          366px of chrome duplicating the header's brand lockup, and it carried a
          hardcoded copyright year that had already gone stale. Attribution is
          the obligation that actually matters here -- the app holds no copyright
          in the data it displays -- so that is all this carries. The data-source
          detail moved to the landing page, where it reads as a trust signal. */}
      <footer className="mt-8 border-t border-gray-200 py-4 pb-24 md:pb-4">
        <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 text-xs text-gray-500 sm:px-6 lg:px-8">
          <span>Data © OpenStreetMap contributors</span>
          <span aria-hidden="true">·</span>
          <span>Geocoding by Nominatim</span>
          <span aria-hidden="true">·</span>
          <a
            href="https://wiki.openstreetmap.org/wiki/Key:diet"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-source-600 hover:text-source-700 hover:underline"
          >
            Dietary tags: OSM diet:* keys
            <ExternalIcon size={ICON_SM} {...iconProps} />
          </a>
        </p>
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative py-4 text-sm font-medium transition-colors",
        active ? "text-gray-900" : "text-gray-600 hover:text-gray-900"
      )}
    >
      {children}
      {/* An ink rule rather than coloured text: colour in this app is reserved
          for what we can and cannot verify. */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-gray-900"
        />
      )}
    </button>
  );
}

/** Used only to pace the interpretation stepper — not a real agent wait. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
