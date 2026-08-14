import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Recommendation,
  DietaryRequest,
  MapData,
  ParsedIntent,
} from "@/types";

export interface RecentSearch {
  id: string;
  query: string;
  location: string;
  dietaryPreferences: string[];
  timestamp: number;
  resultCount: number;
}

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
    | "evidence"
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
        set((state) => ({
          savedRestaurants: [saved, ...state.savedRestaurants],
        }));
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
      version: 2,
      partialize: (state) => ({
        recentSearches: state.recentSearches,
        savedRestaurants: state.savedRestaurants,
      }),
    }
  )
);
