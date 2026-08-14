"use client";

/**
 * Natural-language search form. Quick-filter chips must be keys of the
 * dietary vocabulary that map to OSM `diet:*` tags — a chip that cannot be
 * filtered on would look "active" while changing nothing.
 */
import { useState } from "react";
import { EXAMPLE_PROMPTS, SEARCH_PLACEHOLDER } from "@/lib/prompts";

interface SearchFormProps {
  onSubmit: (data: {
    query: string;
    location: string;
    dietaryPreferences: string[];
    allergies: string[];
    cuisinePreferences: string[];
  }) => void;
  isLoading: boolean;
  /**
   * Seeds the form. Used by the landing-page example prompts and by "Rerun" in
   * Saved — both of which previously navigated here and dropped the query they
   * were displaying, landing the user on a blank textarea.
   */
  initial?: {
    query?: string;
    location?: string;
    dietaryPreferences?: string[];
  };
}

// Every value here must be a key of DIETARY_KEYWORDS in dietary-intent-agent.ts,
// and every one of these maps to a diet:* tag we can actually filter on in
// OpenStreetMap. Chips for things OSM cannot express (high-protein, jain,
// open-now, cuisine families) would render back to the user as an "active
// filter" that filtered nothing.
const QUICK_FILTERS = [
  { label: "🥬 Vegan", value: "vegan" },
  { label: "🥗 Vegetarian", value: "vegetarian" },
  { label: "🚫 Gluten-Free", value: "gluten-free" },
  { label: "🥛 Dairy-Free", value: "dairy-free" },
  { label: "☪️ Halal", value: "halal" },
  { label: "✡️ Kosher", value: "kosher" },
];


/** Collects query, location, OSM-mappable diet chips, and allergy labels. */
export function SearchForm({ onSubmit, isLoading, initial }: SearchFormProps) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [selectedFilters, setSelectedFilters] = useState<string[]>(
    initial?.dietaryPreferences ?? []
  );
  const [allergies, setAllergies] = useState<string[]>([]);
  const [allergyDraft, setAllergyDraft] = useState("");

  const toggleFilter = (value: string) => {
    setSelectedFilters((prev) =>
      prev.includes(value)
        ? prev.filter((f) => f !== value)
        : [...prev, value]
    );
  };

  const addAllergy = () => {
    const value = allergyDraft.trim().toLowerCase();
    if (!value || allergies.includes(value)) {
      setAllergyDraft("");
      return;
    }
    setAllergies((prev) => [...prev, value]);
    setAllergyDraft("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    // Fold any half-typed allergy in rather than silently dropping it.
    const draft = allergyDraft.trim().toLowerCase();
    const finalAllergies =
      draft && !allergies.includes(draft) ? [...allergies, draft] : allergies;
    onSubmit({
      query,
      location,
      dietaryPreferences: selectedFilters,
      allergies: finalAllergies,
      cuisinePreferences: [],
    });
  };

  const handlePromptClick = (prompt: string) => {
    setQuery(prompt);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Main Input + Location - side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 relative">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER}
            className="w-full px-5 py-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-sm resize-none h-28 bg-white shadow-sm"
            required
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-primary-500 hover:bg-primary-600 disabled:bg-gray-300 text-white flex items-center justify-center transition-colors shadow-md"
            aria-label="Search"
          >
            {isLoading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            )}
          </button>
        </div>

        <div className="space-y-3">
          {/* Location */}
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2 shadow-sm">
            <span className="text-primary-500 text-sm">📍</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Enter city or address"
              className="flex-1 text-sm text-gray-700 bg-transparent outline-none"
            />
            {location && (
              <button type="button" onClick={() => setLocation("")} className="text-xs text-primary-500 font-semibold">
                Clear
              </button>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="w-full py-3 bg-primary-500 hover:bg-primary-600 disabled:bg-gray-300 text-white font-semibold rounded-full transition-colors text-sm"
          >
            {isLoading ? "Searching..." : "Search with AI"}
          </button>
        </div>
      </div>

      {/* Quick Filters */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">
          Quick Filters
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => toggleFilter(filter.value)}
              className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                selectedFilters.includes(filter.value)
                  ? "bg-primary-500 text-white shadow-sm"
                  : "bg-white border border-gray-200 text-gray-700 hover:border-primary-300 hover:shadow-sm"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Allergies */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">
          Allergies
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {allergies.map((allergy) => (
            <span
              key={allergy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200"
            >
              {allergy}
              <button
                type="button"
                onClick={() =>
                  setAllergies((prev) => prev.filter((a) => a !== allergy))
                }
                className="text-red-400 hover:text-red-700"
                aria-label={`Remove ${allergy}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={allergyDraft}
            onChange={(e) => setAllergyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addAllergy();
              }
            }}
            onBlur={addAllergy}
            placeholder="e.g. peanuts — press Enter"
            className="px-3 py-1.5 border border-gray-200 rounded-full text-xs bg-white shadow-sm outline-none focus:ring-2 focus:ring-primary-500 min-w-[12rem]"
          />
        </div>
        {allergies.length > 0 && (
          <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ OpenStreetMap has no allergen or cross-contamination data, so we
            cannot verify allergy safety. We use this only to surface contact
            details so you can call ahead — always tell staff directly.
          </p>
        )}
      </div>

      {/* Example Prompts */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">
          Try These Prompts
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handlePromptClick(prompt)}
              className="text-left px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-600 hover:border-primary-300 hover:bg-primary-50 transition-all shadow-sm"
            >
              {`"${prompt}"`}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
