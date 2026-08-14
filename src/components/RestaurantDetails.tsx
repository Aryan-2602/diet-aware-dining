"use client";

/**
 * Everything about one restaurant, on one screen.
 *
 * This absorbed the former Evidence screen, which rendered a strict subset of
 * what this already showed — same confidence, same sub-scores, same warnings,
 * a different grouping of the same evidence array, and fewer links. The two
 * screens mostly existed to link to each other.
 */
import { useAppStore } from "@/store";

/** Full detail for `selectedRestaurant`, including its evidence breakdown. */
export function RestaurantDetails() {
  const selectedRestaurant = useAppStore((s) => s.selectedRestaurant);
  const setPage = useAppStore((s) => s.setPage);
  const saveRestaurant = useAppStore((s) => s.saveRestaurant);
  const unsaveRestaurant = useAppStore((s) => s.unsaveRestaurant);
  // Subscribes to the saved list itself, not the isRestaurantSaved getter.
  // Selecting the getter returns the same function reference on every render,
  // so zustand's Object.is check saw no change and the button never re-rendered
  // — the label stayed "☆ Save" after saving, and users clicked again.
  const savedRestaurants = useAppStore((s) => s.savedRestaurants);

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
  const isSaved = savedRestaurants.some((s) => s.id === restaurant.id);

  // Menu evidence is deliberately absent: `menuConfirmed` is always false,
  // because OpenStreetMap never confirms a menu. The old screens rendered a
  // heading and an empty-state card for it on every restaurant.
  const verified = evidence.filter((e) => e.verified);
  const unverified = evidence.filter((e) => !e.verified);

  const handleToggleSave = () =>
    isSaved ? unsaveRestaurant(restaurant.id) : saveRestaurant(selectedRestaurant);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <button
        onClick={() => setPage("results")}
        className="text-sm text-gray-500 hover:text-gray-700 font-medium"
      >
        ← Back to results
      </button>

      {/* 1. Identity, dietary tags, contact */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">
              {restaurant.name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {restaurant.address}
              {typeof restaurant.distance === "number" &&
                ` • ${(restaurant.distance / 1000).toFixed(1)} km away`}
            </p>
            {restaurant.cuisine.length > 0 && (
              <p className="text-sm text-gray-500 capitalize mt-0.5">
                {restaurant.cuisine.join(", ")}
              </p>
            )}
          </div>
          <button
            onClick={handleToggleSave}
            className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isSaved
                ? "bg-primary-100 text-primary-700"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {isSaved ? "★ Saved" : "☆ Save"}
          </button>
        </div>

        {restaurant.dietaryOptions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {restaurant.dietaryOptions.map((option) => (
              <span
                key={option}
                className="px-3 py-1 bg-primary-50 text-primary-700 text-xs font-semibold rounded-full capitalize"
              >
                ✓ {option}
              </span>
            ))}
          </div>
        )}

        {/* Contact details. Previously returned by the API and rendered
            nowhere, while the search form promised we would surface them so
            you could call ahead about allergies. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 pt-4 border-t border-gray-100 text-sm">
          {restaurant.phone && (
            <a
              href={`tel:${restaurant.phone.replace(/\s/g, "")}`}
              className="font-medium text-primary-600 hover:text-primary-700"
            >
              📞 {restaurant.phone}
            </a>
          )}
          {restaurant.website && (
            <a
              href={restaurant.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-900 underline"
            >
              Website
            </a>
          )}
          {restaurant.openingHours && (
            <span className="text-gray-500">🕐 {restaurant.openingHours}</span>
          )}
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${restaurant.location.lat},${restaurant.location.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-900 underline"
          >
            Directions
          </a>
        </div>
      </div>

      {/* 2. Why it matched, and what we could not check */}
      {(matchReasons.length > 0 || warnings.length > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          {matchReasons.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">
                Why this matched
              </h2>
              <ul className="space-y-1.5">
                {matchReasons.map((reason, i) => (
                  <li key={i} className="text-sm text-gray-700 flex gap-2">
                    <span className="text-primary-500">✓</span>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-amber-900 mb-2">
                What we could not verify
              </h2>
              <ul className="space-y-1.5">
                {warnings.map((warning, i) => (
                  <li key={i} className="text-sm text-amber-800 flex gap-2">
                    <span>⚠️</span>
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 3. Verification: score, sub-scores, and the raw OSM evidence */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Verification strength
          </h2>
          <span className="text-2xl font-bold text-primary-600">
            {Math.round(confidence.overall * 100)}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <ScoreBar label="Diet Tag Strength" value={confidence.dietTagStrength} />
          <ScoreBar label="Needs Covered" value={confidence.coverage} />
          <ScoreBar label="Listing Detail" value={confidence.dataCompleteness} />
          <ScoreBar label="Last Checked" value={confidence.tagRecency} />
        </div>

        {verified.length > 0 && (
          <div className="mb-3">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Confirmed in OpenStreetMap ({verified.length})
            </h3>
            <ul className="space-y-1.5">
              {verified.map((e, i) => (
                <li
                  key={i}
                  className="text-sm text-gray-700 px-3 py-2 bg-primary-50 rounded-lg flex items-center justify-between gap-3"
                >
                  <span>✓ {e.claim}</span>
                  <span className="flex-shrink-0 text-xs text-gray-500">
                    {Math.round(e.confidence * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {unverified.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Not verifiable ({unverified.length})
            </h3>
            <ul className="space-y-1.5">
              {unverified.map((e, i) => (
                <li
                  key={i}
                  className="text-sm text-amber-800 px-3 py-2 bg-amber-50 rounded-lg"
                >
                  ? {e.claim}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-4 mt-5 pt-4 border-t border-gray-100 text-xs">
          <a
            href={`https://www.openstreetmap.org/${restaurant.osmType}/${restaurant.osmId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 hover:text-blue-700 underline"
          >
            Verify on OpenStreetMap
          </a>
          {/* Replaces a "Report Inaccuracy" button that had no onClick at all.
              The data is wrong *in OSM*, so the honest action is to let the
              user fix it at the source. */}
          <a
            href={`https://www.openstreetmap.org/edit?${restaurant.osmType}=${restaurant.osmId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-gray-700 underline"
          >
            Something wrong? Edit it in OpenStreetMap
          </a>
        </div>
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
