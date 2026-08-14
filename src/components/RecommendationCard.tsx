"use client";

/**
 * One verified restaurant. Evidence quotes are omitted when none exist —
 * never fabricated. The OSM verify link uses `osmType`/`osmId`, not a
 * name search, so it opens the exact mapped object.
 */
import { Recommendation } from "@/types";
import { useAppStore } from "@/store";

interface RecommendationCardProps {
  recommendation: Recommendation;
  rank: number;
}

/** Ranked card: OSM tags, evidence, Maps link. Opens details/evidence via the store. */
export function RecommendationCard({
  recommendation,
  rank,
}: RecommendationCardProps) {
  const { restaurant, confidence, evidence, matchReasons, warnings } =
    recommendation;
  const setSelectedRestaurant = useAppStore((s) => s.setSelectedRestaurant);
  const setPage = useAppStore((s) => s.setPage);

  const confidencePercent = Math.round(confidence.overall * 100);
  const confidenceColor =
    confidencePercent >= 85
      ? "bg-primary-500 text-white"
      : confidencePercent >= 70
      ? "bg-amber-500 text-white"
      : "bg-gray-400 text-white";

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    restaurant.name + " " + restaurant.address
  )}`;

  // Only ever a real, verified claim. When there is none, nothing is shown —
  // the previous fallback fabricated a quotation and styled it as sourced.
  const evidenceQuote = evidence.find((e) => e.verified)?.claim ?? null;

  const distanceText = restaurant.distance
    ? `${(restaurant.distance / 1000).toFixed(1)} km`
    : "";

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Top Row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center font-bold text-sm">
            {rank}
          </span>
          <div className="min-w-0">
            <button
              onClick={() => {
                setSelectedRestaurant(recommendation);
                setPage("details");
              }}
              className="text-base font-bold text-gray-900 hover:text-primary-600 text-left transition-colors truncate block"
            >
              {restaurant.name}
            </button>
            <p className="text-sm text-gray-500">
              {restaurant.cuisine.join(", ")}
              {distanceText && ` • ${distanceText}`}
              {restaurant.address !== restaurant.name && ` • ${restaurant.address}`}
            </p>
          </div>
        </div>
        <span className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold ${confidenceColor}`}>
          {confidencePercent}% verified
        </span>
      </div>

      {/* Dietary Tags */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {restaurant.dietaryOptions.map((opt) => (
          <span
            key={opt}
            className="px-2.5 py-0.5 bg-primary-50 text-primary-700 text-xs rounded-full font-medium"
          >
            {opt} ✓
          </span>
        ))}
        {matchReasons.slice(0, 2).map((reason, i) => (
          <span key={i} className="text-xs text-gray-500">
            • {reason}
          </span>
        ))}
      </div>

      {/* Evidence Quote — omitted entirely when there is nothing to quote */}
      {evidenceQuote && (
        <p className="text-sm text-gray-600 mt-3 leading-relaxed bg-gray-50 rounded-lg px-3 py-2">
          {evidenceQuote}
        </p>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mt-2">
          {warnings.map((warning, i) => (
            <p key={i} className="text-xs text-amber-600 flex items-center gap-1">
              ⚠️ {warning}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setSelectedRestaurant(recommendation);
              setPage("evidence");
            }}
            className="text-sm font-semibold text-primary-500 hover:text-primary-600 transition-colors"
          >
            View Evidence
          </button>
          <button
            onClick={() => {
              setSelectedRestaurant(recommendation);
              setPage("details");
            }}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Details
          </button>
        </div>
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Open in Maps
        </a>
      </div>

      {/* Data Sources Expandable */}
      <details className="mt-3 pt-3 border-t border-gray-50">
        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 font-medium flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
          Sources ({evidence.length} evidence points)
        </summary>
        <div className="mt-3 space-y-3 pl-5">
          {/* What is OSM info box */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 text-xs text-blue-800">
            <p className="font-semibold mb-1">📍 Data Source: OpenStreetMap (OSM)</p>
            <p className="text-blue-700 leading-relaxed">
              OSM is the Wikipedia of maps — a free, community-maintained database with 10M+ contributors worldwide.
              Dietary tags (vegan, halal, gluten-free) are verified by local mappers who visit these restaurants.
            </p>
          </div>

          {/* Evidence list */}
          {evidence.map((e, i) => (
            <div key={i} className="text-xs flex items-center justify-between gap-3 py-0.5">
              <span className="flex items-center gap-1.5 text-gray-600">
                {e.verified ? (
                  <span className="text-primary-500">✓</span>
                ) : (
                  <span className="text-amber-400">◐</span>
                )}
                {e.claim}
              </span>
              <span className={`font-medium ${
                e.confidence >= 0.7 ? "text-primary-600" : e.confidence >= 0.5 ? "text-amber-600" : "text-red-500"
              }`}>
                {Math.round(e.confidence * 100)}%
              </span>
            </div>
          ))}

          {/* Verify link */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <a
              href={`https://www.openstreetmap.org/${restaurant.osmType}/${restaurant.osmId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 underline flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Verify on OpenStreetMap
            </a>
            <a
              href="https://wiki.openstreetmap.org/wiki/Key:diet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              How OSM dietary tags work
            </a>
          </div>

          <p className="text-[10px] text-gray-400 italic">
            Real-time data fetched via{" "}
            <a href="https://overpass-api.de" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">
              Overpass API
            </a>{" "}
            + geocoded with{" "}
            <a href="https://nominatim.openstreetmap.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">
              Nominatim
            </a>
            . OpenStreetMap has no ratings, reviews or prices, so none are shown.
          </p>
        </div>
      </details>
    </div>
  );
}
