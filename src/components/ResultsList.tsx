"use client";

/**
 * Unused. Superseded by ResultsMapView (map + cards). Not imported from page.tsx.
 * Empty-state copy is the old generic "try broadening" message.
 */
import { Recommendation } from "@/types";
import { RecommendationCard } from "./RecommendationCard";

interface ResultsListProps {
  recommendations: Recommendation[];
  metadata: {
    totalFound: number;
    verified: number;
    avgConfidence: number;
  };
}

/** Legacy list-only results — not wired into page.tsx. */
export function ResultsList({ recommendations, metadata }: ResultsListProps) {
  if (recommendations.length === 0) {
    return (
      <div className="w-full max-w-2xl mx-auto text-center py-8">
        <p className="text-gray-500">
          No restaurants found matching your criteria. Try broadening your
          search.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Results summary */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-semibold text-gray-800">
          {recommendations.length} Recommendation
          {recommendations.length !== 1 ? "s" : ""}
        </h2>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{metadata.totalFound} searched</span>
          <span>•</span>
          <span>{metadata.verified} claims verified</span>
          <span>•</span>
          <span>{Math.round(metadata.avgConfidence * 100)}% avg confidence</span>
        </div>
      </div>

      {/* Recommendation cards */}
      <div className="space-y-3">
        {recommendations.map((rec, index) => (
          <RecommendationCard
            key={rec.restaurant.id}
            recommendation={rec}
            rank={index + 1}
          />
        ))}
      </div>
    </div>
  );
}
