"use client";

/**
 * Results screen: OSM embed + ranked cards. Empty sets are not a generic
 * "try broadening" message — they use `searchMeta` to say which constraint,
 * radius, and candidate count produced zero verified matches. Allergies
 * always get a banner: OSM cannot verify them.
 */
import { useState } from "react";
import { useAppStore } from "@/store";
import { RecommendationCard } from "./RecommendationCard";
import { Recommendation } from "@/types";

type SortMode = "confidence" | "distance";

/** Map + list for the current search; reads everything from the store. */
export function ResultsMapView() {
  const recommendations = useAppStore((s) => s.recommendations);
  const mapData = useAppStore((s) => s.mapData);
  const metadata = useAppStore((s) => s.metadata);
  const parsedIntent = useAppStore((s) => s.parsedIntent);
  const searchMeta = useAppStore((s) => s.searchMeta);
  const setPage = useAppStore((s) => s.setPage);
  const [sortMode, setSortMode] = useState<SortMode>("confidence");

  const sortedRecommendations = sortResults(recommendations, sortMode);

  if (recommendations.length === 0) {
    // An empty result set explains itself: which constraint, how far we looked,
    // how many places were considered. The previous copy — "try broadening your
    // search" — was shown identically for geocode failures, rate limits and
    // genuine emptiness, and told the user nothing about which had happened.
    const needs = searchMeta?.enforceableNeeds ?? [];
    const km = searchMeta ? Math.round(searchMeta.radiusSearchedM / 1000) : null;

    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="text-6xl mb-4">🔍</div>
        <h2 className="text-xl font-bold text-gray-800 mb-3">
          No verified matches
        </h2>

        {searchMeta ? (
          <p className="text-gray-600 mb-2">
            No restaurant within {km} km of{" "}
            <span className="font-medium">{searchMeta.resolvedLocation}</span>{" "}
            {needs.length > 0 ? (
              <>
                is tagged{" "}
                <span className="font-medium">{needs.join(" and ")}</span> in
                OpenStreetMap.
              </>
            ) : (
              "matched your search."
            )}
          </p>
        ) : (
          <p className="text-gray-600 mb-2">
            Nothing matched your search.
          </p>
        )}

        {searchMeta && searchMeta.candidatesScanned > 0 && (
          <p className="text-sm text-gray-500 mb-2">
            We checked {searchMeta.candidatesScanned} places.
          </p>
        )}

        <p className="text-sm text-gray-500 mb-6">
          We only show places whose dietary tags we can verify, so we would
          rather show you nothing than a guess.
        </p>

        {searchMeta && searchMeta.unenforceableNeeds.length > 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 text-left">
            OpenStreetMap has no tag for{" "}
            <span className="font-medium">
              {searchMeta.unenforceableNeeds.join(", ")}
            </span>
            , so that part of your request could not be checked at all.
          </p>
        )}

        <button
          onClick={() => setPage("search")}
          className="px-6 py-2.5 text-primary-600 font-semibold hover:bg-primary-50 rounded-full transition-colors border border-primary-200"
        >
          ← Modify Search
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Allergies can never be verified from OpenStreetMap, so this is shown
          whenever any were given and cannot be dismissed. */}
      {parsedIntent && parsedIntent.restrictions.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-800 font-semibold mb-1">
            ⚠️ Allergy information cannot be verified
          </p>
          <p className="text-sm text-red-700">
            OpenStreetMap holds no allergen or cross-contamination data. Nothing
            below has been checked for{" "}
            <span className="font-medium">
              {parsedIntent.restrictions.join(", ")}
            </span>
            . Call ahead and tell staff directly.
          </p>
        </div>
      )}

      {searchMeta && searchMeta.unenforceableNeeds.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-900">
            OpenStreetMap has no tag for{" "}
            <span className="font-medium">
              {searchMeta.unenforceableNeeds.join(", ")}
            </span>
            , so results below are filtered on{" "}
            {searchMeta.enforceableNeeds.length > 0 ? (
              <span className="font-medium">
                {searchMeta.enforceableNeeds.join(" and ")}
              </span>
            ) : (
              "location"
            )}{" "}
            only.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            Results ({recommendations.length})
          </h2>
          {metadata && (
            <p className="text-sm text-gray-500 mt-1">
              {metadata.candidatesScanned ?? 0} places checked •{" "}
              {recommendations.length} verified match
              {recommendations.length === 1 ? "" : "es"} •{" "}
              {Math.round(metadata.avgConfidence * 100)}% avg verification
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(
            [
              { key: "confidence", label: "Verification" },
              { key: "distance", label: "Distance" },
            ] as const
          ).map((btn) => (
            <button
              key={btn.key}
              onClick={() => setSortMode(btn.key)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${
                sortMode === btn.key
                  ? "bg-primary-500 text-white shadow-sm"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-primary-300"
              }`}
            >
              {btn.label}
            </button>
          ))}
          <button
            onClick={() => setPage("search")}
            className="ml-2 px-4 py-2 text-xs font-semibold text-primary-600 hover:bg-primary-50 rounded-full transition-colors"
          >
            ← Modify
          </button>
        </div>
      </div>

      {/* Active Filters */}
      {parsedIntent && parsedIntent.dietaryNeeds.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Active filters:</span>
          {parsedIntent.dietaryNeeds.map((need) => (
            <span
              key={need}
              className="px-3 py-1 bg-primary-50 text-primary-700 text-xs font-semibold rounded-full capitalize"
            >
              {need}
            </span>
          ))}
        </div>
      )}

      {/* Desktop: Map + Cards side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Map - takes 2 cols on desktop */}
        {mapData && mapData.markers.length > 0 && (
          <div className="lg:col-span-2 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-xl overflow-hidden shadow-sm border border-gray-100 bg-white">
              <iframe
                title="Restaurant locations"
                width="100%"
                height="400"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapData.bounds.west},${mapData.bounds.south},${mapData.bounds.east},${mapData.bounds.north}&layer=mapnik&marker=${mapData.center.lat},${mapData.center.lng}`}
              />
            </div>
            {metadata && (
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                Map data © OpenStreetMap contributors
              </p>
            )}
          </div>
        )}

        {/* Cards - takes 3 cols */}
        <div className={`space-y-4 ${mapData && mapData.markers.length > 0 ? "lg:col-span-3" : "lg:col-span-5"}`}>
          {sortedRecommendations.map((rec, index) => (
            <RecommendationCard
              key={rec.restaurant.id}
              recommendation={rec}
              rank={index + 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Client-side reorder only — ranking from the API is already by confidence. */
function sortResults(recs: Recommendation[], mode: SortMode): Recommendation[] {
  const sorted = [...recs];
  switch (mode) {
    case "confidence":
      return sorted.sort((a, b) => b.confidence.overall - a.confidence.overall);
    case "distance":
      return sorted.sort((a, b) => (a.restaurant.distance ?? 9999) - (b.restaurant.distance ?? 9999));
    default:
      return sorted;
  }
}
