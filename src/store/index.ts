/**
 * Client app state. Navigation and live search results are in-memory only;
 * a refresh always returns to the landing screen. Only `recentSearches` and
 * `savedRestaurants` are written to localStorage (`dietary-ai-storage-v2`).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Recommendation,
  DietaryRequest,
  MapData,
  ParsedIntent,
} from "@/types";

/** One past query, kept so SavedRecentView can re-display it (not re-run it). */
export interface RecentSearch {
  id: string;
  query: string;
  location: string;
  dietaryPreferences: string[];
  timestamp: number;
  resultCount: number;
}

/** Counts for the results header: what was shown, not every discarded candidate. */
export interface SearchMetadata {
  totalFound: number;
  candidatesScanned?: number;
  verified: number;
  avgConfidence: number;
}

/** Reported to the user so an empty result set can explain itself. */
export interface SearchMeta {
  enforceableNeeds: string[];
  unenforceableNeeds: string[];
  effectiveRadiusM: number;
  radiusSearchedM: number;
  candidatesScanned: number;
  resolvedLocation: string;
}

/** Values used to prefill the search form when navigating to it. */
export interface SearchSeed {
  query: string;
  location?: string;
  dietaryPreferences?: string[];
}

/** A recommendation the user pinned; the full object is stored, not just an id. */
export interface SavedRestaurant {
  id: string;
  recommendation: Recommendation;
  savedAt: number;
}

interface AppStore {
  // Navigation
  currentPage:
    | "landing"
    | "search"
    | "interpretation"
    | "results"
    | "details"
    | "saved";
  setPage: (page: AppStore["currentPage"]) => void;

  // Search results
  recommendations: Recommendation[];
  mapData: MapData | null;
  parsedIntent: ParsedIntent | null;
  metadata: SearchMetadata | null;
  /** What the search actually did — radius, needs OSM could not express. */
  searchMeta: SearchMeta | null;
  setResults: (
    recommendations: Recommendation[],
    mapData: MapData | null,
    parsedIntent: ParsedIntent | null,
    metadata: SearchMetadata | null,
    searchMeta?: SearchMeta | null
  ) => void;
  clearResults: () => void;

  /**
   * Prefill for the search form. Set by the landing-page example prompts and by
   * "Rerun" in Saved — both of which used to navigate to search and drop the
   * query they were displaying.
   */
  searchSeed: SearchSeed | null;
  setSearchSeed: (seed: SearchSeed | null) => void;

  // Selected restaurant for detail view
  selectedRestaurant: Recommendation | null;
  setSelectedRestaurant: (rec: Recommendation | null) => void;

  // Recent searches (persisted)
  recentSearches: RecentSearch[];
  addRecentSearch: (request: DietaryRequest, resultCount: number) => void;
  clearRecentSearches: () => void;

  // Saved restaurants (persisted)
  savedRestaurants: SavedRestaurant[];
  saveRestaurant: (recommendation: Recommendation) => void;
  unsaveRestaurant: (restaurantId: string) => void;
  isRestaurantSaved: (restaurantId: string) => boolean;
}

/** Hook for navigation, live results, and persisted saves/recents. */
export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Navigation
      currentPage: "landing",
      setPage: (page) => set({ currentPage: page }),

      // Search results
      recommendations: [],
      mapData: null,
      parsedIntent: null,
      metadata: null,
      searchMeta: null,
      // Coerced defensively: a failed response used to write `undefined` here,
      // after which ResultsMapView crashed spreading it and the app white-screened.
      setResults: (recommendations, mapData, parsedIntent, metadata, searchMeta) =>
        set({
          recommendations: Array.isArray(recommendations) ? recommendations : [],
          mapData: mapData ?? null,
          parsedIntent: parsedIntent ?? null,
          metadata: metadata ?? null,
          searchMeta: searchMeta ?? null,
        }),
      clearResults: () =>
        set({
          recommendations: [],
          mapData: null,
          parsedIntent: null,
          metadata: null,
          searchMeta: null,
        }),

      searchSeed: null,
      setSearchSeed: (seed) => set({ searchSeed: seed }),

      // Selected restaurant
      selectedRestaurant: null,
      setSelectedRestaurant: (rec) => set({ selectedRestaurant: rec }),

      // Recent searches
      recentSearches: [],
      addRecentSearch: (request, resultCount) => {
        const search: RecentSearch = {
          id: `search-${Date.now()}`,
          query: request.query,
          location: request.location || "",
          dietaryPreferences: request.dietaryPreferences,
          timestamp: Date.now(),
          resultCount,
        };
        set((state) => ({
          recentSearches: [search, ...state.recentSearches].slice(0, 20),
        }));
      },
      clearRecentSearches: () => set({ recentSearches: [] }),

      // Saved restaurants
      savedRestaurants: [],
      saveRestaurant: (recommendation) => {
        const saved: SavedRestaurant = {
          id: recommendation.restaurant.id,
          recommendation,
          savedAt: Date.now(),
        };
        set((state) => {
          // Idempotent. Previously this prepended unconditionally, and because
          // the Save button never re-rendered (it read a getter rather than the
          // list), users clicked repeatedly and persisted N copies of the same
          // restaurant — duplicate React keys, an inflated count, and a Remove
          // that deleted all N at once.
          if (state.savedRestaurants.some((s) => s.id === saved.id)) {
            return state;
          }
          return { savedRestaurants: [saved, ...state.savedRestaurants] };
        });
      },
      unsaveRestaurant: (restaurantId) => {
        set((state) => ({
          savedRestaurants: state.savedRestaurants.filter(
            (s) => s.id !== restaurantId
          ),
        }));
      },
      isRestaurantSaved: (restaurantId) => {
        return get().savedRestaurants.some((s) => s.id === restaurantId);
      },
    }),
    {
      // Bumped: restaurant ids changed from `osm-<id>` to `osm-<type>-<id>`,
      // and Restaurant lost the fabricated rating/priceLevel/source fields.
      // Rehydrating pre-existing saves would put objects of the old shape into
      // components that now index the new one.
      name: "dietary-ai-storage-v2",
      version: 3,
      partialize: (state) => ({
        recentSearches: state.recentSearches,
        savedRestaurants: state.savedRestaurants,
      }),
      // Anyone who used the app before the Save fix has duplicate entries
      // persisted. Collapse them on rehydrate rather than making the user
      // clear storage; keeping the first occurrence preserves savedAt order.
      migrate: (persisted, version) => {
        const state = persisted as Partial<AppStore> | undefined;
        if (!state) return persisted as AppStore;
        if (version < 3 && Array.isArray(state.savedRestaurants)) {
          const seen = new Set<string>();
          state.savedRestaurants = state.savedRestaurants.filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          });
        }
        return state as AppStore;
      },
    }
  )
);
