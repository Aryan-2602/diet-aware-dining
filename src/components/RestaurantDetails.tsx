"use client";

/**
 * Full restaurant screen. Requires `selectedRestaurant` in the store — there
 * is no URL param, so a direct visit or refresh with no selection shows empty.
 */
import { useAppStore } from "@/store";

/** Detail + save/unsave for the currently selected recommendation. */
export function RestaurantDetails() {
  const selectedRestaurant = useAppStore((s) => s.selectedRestaurant);
  const setPage = useAppStore((s) => s.setPage);
  const saveRestaurant = useAppStore((s) => s.saveRestaurant);
  const unsaveRestaurant = useAppStore((s) => s.unsaveRestaurant);
  const isRestaurantSaved = useAppStore((s) => s.isRestaurantSaved);

  if (!selectedRestaurant) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No restaurant selected.</p>
        <button
          onClick={() => setPage("results")}
          className="mt-4 text-primary-600 hover:text-primary-700 font-medium"
        >
          ← Back to Results
        </button>
      </div>
    );
  }

  const { restaurant, confidence, matchReasons, warnings, evidence } =
    selectedRestaurant;
  const isSaved = isRestaurantSaved(restaurant.id);

  const handleToggleSave = () => {
    if (isSaved) {
      unsaveRestaurant(restaurant.id);
    } else {
      saveRestaurant(selectedRestaurant);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => setPage("results")}
        className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Map
      </button>

      {/* Restaurant Header */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Photo placeholder */}
        <div className="h-48 bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center">
          <span className="text-6xl">🍽️</span>
        </div>

        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {restaurant.name}
              </h1>
              <p className="text-gray-500">{restaurant.address}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleToggleSave}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isSaved
                    ? "bg-primary-100 text-primary-700"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {isSaved ? "★ Saved" : "☆ Save"}
              </button>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
            {typeof restaurant.distance === "number" && (
              <span>{(restaurant.distance / 1000).toFixed(1)} km away</span>
            )}
            {restaurant.lastCheckedISO && (
              <span>Checked {restaurant.lastCheckedISO}</span>
            )}
            <span className="capitalize">
              {restaurant.cuisine.join(", ")}
            </span>
          </div>

          {/* Dietary options */}
          <div className="flex flex-wrap gap-2 mb-4">
            {restaurant.dietaryOptions.map((option) => (
              <span
                key={option}
                className="px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-sm font-medium"
              >
                ✓ {option}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Confidence Score */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Dietary Confidence
        </h2>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600">Overall Confidence</span>
            <span className="text-lg font-bold text-primary-700">
              {Math.round(confidence.overall * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-primary-500 h-3 rounded-full transition-all"
              style={{ width: `${confidence.overall * 100}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ScoreBar label="Diet Tag Strength" value={confidence.dietTagStrength} />
          <ScoreBar label="Needs Covered" value={confidence.coverage} />
          <ScoreBar label="Listing Detail" value={confidence.dataCompleteness} />
          <ScoreBar label="Last Checked" value={confidence.tagRecency} />
        </div>

        <button
          onClick={() => setPage("evidence")}
          className="mt-4 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          View Full Evidence →
        </button>
      </div>

      {/* Match Reasons */}
      {matchReasons.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Why This Restaurant
          </h2>
          <ul className="space-y-2">
            {matchReasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <svg className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 rounded-2xl p-6 border border-amber-200">
          <h2 className="text-lg font-semibold text-amber-800 mb-3">
            ⚠️ Important Notes
          </h2>
          <ul className="space-y-2">
            {warnings.map((warning, i) => (
              <li key={i} className="text-sm text-amber-700">
                • {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Menu highlights (mock) */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Menu Highlights
        </h2>
        <div className="space-y-2">
          {evidence
            .filter((e) => e.menuConfirmed)
            .slice(0, 3)
            .map((e, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-gray-700 p-2 bg-gray-50 rounded-lg"
              >
                <span className="text-primary-500">✓</span>
                {e.claim}
              </div>
            ))}
          {evidence.filter((e) => e.menuConfirmed).length === 0 && (
            <p className="text-sm text-gray-500 italic">
              Menu data not available for independent verification.
            </p>
          )}
        </div>
      </div>

      {/* Google Maps Button */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Location & Directions
        </h2>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${restaurant.location.lat},${restaurant.location.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
        >
          <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <div>
            <p className="font-medium text-blue-700">Open in Google Maps</p>
            <p className="text-sm text-blue-600">{restaurant.address}</p>
          </div>
        </a>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-xs font-medium text-gray-700">
          {Math.round(value * 100)}%
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1.5">
        <div
          className="bg-primary-400 h-1.5 rounded-full"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}
