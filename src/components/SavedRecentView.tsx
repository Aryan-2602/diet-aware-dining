"use client";

/**
 * Persisted saves and recent queries. Opening a saved place only sets
 * `selectedRestaurant` and switches to details — it does not re-run search.
 */
import { useAppStore } from "@/store";

/** Saved restaurants and recent queries from localStorage. */
export function SavedRecentView() {
  const recentSearches = useAppStore((s) => s.recentSearches);
  const savedRestaurants = useAppStore((s) => s.savedRestaurants);
  const setPage = useAppStore((s) => s.setPage);
  const setSearchSeed = useAppStore((s) => s.setSearchSeed);
  const setSelectedRestaurant = useAppStore((s) => s.setSelectedRestaurant);
  const unsaveRestaurant = useAppStore((s) => s.unsaveRestaurant);
  const clearRecentSearches = useAppStore((s) => s.clearRecentSearches);

  /** Jump to details without calling `/api/recommend` again. */
  const handleViewDetails = (rec: typeof savedRestaurants[0]) => {
    setSelectedRestaurant(rec.recommendation);
    setPage("details");
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Saved & Recent</h1>
        <button
          onClick={() => setPage("search")}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          New Search
        </button>
      </div>

      {/* Recent Searches */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Recent Searches
          </h2>
          {recentSearches.length > 0 && (
            <button
              onClick={clearRecentSearches}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear all
            </button>
          )}
        </div>

        {recentSearches.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No recent searches yet. Start searching to see your history here.
          </p>
        ) : (
          <div className="space-y-2">
            {recentSearches.slice(0, 10).map((search) => (
              <div
                key={search.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {search.query}
                  </p>
                  <p className="text-xs text-gray-500">
                    {search.location && `${search.location} • `}
                    {search.resultCount} results •{" "}
                    {formatTimestamp(search.timestamp)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    // Previously this just navigated to an empty form, even
                    // though the stored search carries all three fields.
                    setSearchSeed({
                      query: search.query,
                      location: search.location,
                      dietaryPreferences: search.dietaryPreferences,
                    });
                    setPage("search");
                  }}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium px-3 py-1 rounded-lg hover:bg-primary-50"
                >
                  Rerun
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Restaurants */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Saved Restaurants ({savedRestaurants.length})
        </h2>

        {savedRestaurants.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No saved restaurants yet. Save restaurants from the results page to
            access them quickly here.
          </p>
        ) : (
          <div className="space-y-3">
            {savedRestaurants.map((saved) => {
              const { restaurant, confidence } = saved.recommendation;
              return (
                <div
                  key={saved.id}
                  className="p-4 border border-gray-100 rounded-xl hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {restaurant.name}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {restaurant.address}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 bg-primary-50 text-primary-700 text-xs rounded-full font-medium">
                      {Math.round(confidence.overall * 100)}% match
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-3">
                    {restaurant.dietaryOptions.slice(0, 4).map((opt) => (
                      <span
                        key={opt}
                        className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
                      >
                        {opt}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleViewDetails(saved)}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      View Details
                    </button>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${restaurant.location.lat},${restaurant.location.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      Show on Map
                    </a>
                    <button
                      onClick={() => unsaveRestaurant(saved.id)}
                      className="ml-auto text-xs text-gray-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
