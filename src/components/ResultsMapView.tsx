"use client";

import { useState } from "react";
import { useAppStore } from "@/store";
import { RecommendationCard } from "./RecommendationCard";
import { Recommendation } from "@/types";

type SortMode = "confidence" | "distance";

export function ResultsMapView() {
  const recommendations = useAppStore((s) => s.recommendations);
  const mapData = useAppStore((s) => s.mapData);
  const metadata = useAppStore((s) => s.metadata);
  const parsedIntent = useAppStore((s) => s.parsedIntent);
  const setPage = useAppStore((s) => s.setPage);
  const [sortMode, setSortMode] = useState<SortMode>("confidence");

  const sortedRecommendations = sortResults(recommendations, sortMode);

  if (recommendations.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🔍</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">No restaurants found</h2>
        <p className="text-gray-500 mb-6">Try broadening your search or changing location</p>
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            Results ({recommendations.length})
          </h2>
          {metadata && (
            <p className="text-sm text-gray-500 mt-1">
              {metadata.totalFound} searched • {metadata.verified} verified •{" "}
              {Math.round(metadata.avgConfidence * 100)}% avg confidence
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
