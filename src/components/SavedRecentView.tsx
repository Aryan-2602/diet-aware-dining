"use client";

/**
 * Persisted saves and recent queries. Opening a saved place only sets
 * `selectedRestaurant` and switches to details — it does not re-run search.
 */
import { History, RotateCcw, Search } from "lucide-react";
import { useAppStore } from "@/store";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { confidenceTier, TIER_TONE } from "@/lib/confidence";
import { formatRelativeTime, mapsDirectionsUrl, percent } from "@/lib/format";
import {
  ExternalIcon,
  ICON_SM,
  SaveIcon,
  VerifiedIcon,
  iconProps,
} from "@/lib/icons";

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
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Saved &amp; Recent
        </h1>
        <Button variant="primary" icon={Search} onClick={() => setPage("search")}>
          New search
        </Button>
      </div>

      {/* Recent Searches */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">
            Recent searches
          </h2>
          {recentSearches.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearRecentSearches}>
              Clear all
            </Button>
          )}
        </div>

        {recentSearches.length === 0 ? (
          <EmptyState
            icon={History}
            title="No recent searches yet"
            description="Start searching to see your history here."
          />
        ) : (
          <div className="space-y-2">
            {recentSearches.slice(0, 10).map((search) => (
              <div
                key={search.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 transition-colors hover:bg-gray-100"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {search.query}
                  </p>
                  <p className="text-xs text-gray-500">
                    {search.location && `${search.location} • `}
                    <span className="tabular-nums">{search.resultCount}</span>{" "}
                    results •{" "}
                    <time dateTime={new Date(search.timestamp).toISOString()}>
                      {formatRelativeTime(search.timestamp)}
                    </time>
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
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900"
                >
                  <RotateCcw size={ICON_SM} {...iconProps} />
                  Rerun
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Saved Restaurants */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold tracking-tight text-gray-900">
          Saved restaurants (
          <span className="tabular-nums">{savedRestaurants.length}</span>)
        </h2>

        {savedRestaurants.length === 0 ? (
          <EmptyState
            icon={SaveIcon}
            title="No saved restaurants yet"
            description="Save restaurants from the results page to access them quickly here."
          />
        ) : (
          <div className="space-y-3">
            {savedRestaurants.map((saved) => {
              const { restaurant, confidence } = saved.recommendation;
              return (
                <Card key={saved.id} padding="sm" interactive>
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-medium text-gray-900">
                        {restaurant.name}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {restaurant.address}
                      </p>
                    </div>
                    <Badge
                      tone={TIER_TONE[confidenceTier(confidence.overall)]}
                      className="shrink-0 tabular-nums"
                    >
                      {percent(confidence.overall)}% match
                    </Badge>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {/* Same claim, same treatment as the results card. These
                        used to render grey here and green there. */}
                    {restaurant.dietaryOptions.slice(0, 4).map((opt) => (
                      <Badge key={opt} tone="verified" icon={VerifiedIcon}>
                        {opt}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewDetails(saved)}
                    >
                      View details
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={ExternalIcon}
                      href={mapsDirectionsUrl(
                        restaurant.location.lat,
                        restaurant.location.lng
                      )}
                    >
                      Show on map
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      onClick={() => unsaveRestaurant(saved.id)}
                      aria-label={`Remove ${restaurant.name} from saved`}
                      className="ml-auto"
                    >
                      Remove
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

