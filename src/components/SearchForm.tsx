"use client";

/**
 * Natural-language search form. Quick-filter chips must be keys of the
 * dietary vocabulary that map to OSM `diet:*` tags — a chip that cannot be
 * filtered on would look "active" while changing nothing.
 */
import { useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { EXAMPLE_PROMPTS, SEARCH_PLACEHOLDER } from "@/lib/prompts";
import { Alert } from "./ui/Alert";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Field, Input, Textarea } from "./ui/Field";
import { ICON_SM, LocationIcon, SafetyIcon, iconProps } from "@/lib/icons";

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

// Every value here must be a known need in api/_lib/tools/diet_tags.py, and
// every one of these maps to a diet:* tag we can actually filter on in
// OpenStreetMap. Chips for things OSM cannot express (high-protein, jain,
// open-now, cuisine families) would render back to the user as an "active
// filter" that filtered nothing.
// Labels are text only. These previously carried emoji, including ☪️ and ✡️
// used as decoration for halal and kosher -- religious symbols reduced to
// ornament, and rendered differently on every operating system.
const QUICK_FILTERS = [
  { label: "Vegan", value: "vegan" },
  { label: "Vegetarian", value: "vegetarian" },
  { label: "Gluten-free", value: "gluten-free" },
  { label: "Dairy-free", value: "dairy-free" },
  { label: "Halal", value: "halal" },
  { label: "Kosher", value: "kosher" },
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
      {/* Main Input + Location - side by side on desktop.
          There used to be a second submit button floating inside the textarea:
          two type="submit" controls on one form, same disabled rule, same
          action. One submit, and it says what it does. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Field
          label="What do you need"
          className="lg:col-span-2"
        >
          {(field) => (
            <Textarea
              {...field}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={SEARCH_PLACEHOLDER}
              className="h-28"
              required
            />
          )}
        </Field>

        <div className="flex flex-col gap-3">
          <Field label="Location" hint="A city or address. We geocode it before searching.">
            {(field) => (
              <div className="relative">
                <LocationIcon
                  size={ICON_SM}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  {...iconProps}
                />
                <Input
                  {...field}
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Enter city or address"
                  className="pl-8 pr-14"
                />
                {location && (
                  <button
                    type="button"
                    onClick={() => setLocation("")}
                    aria-label="Clear location"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </Field>

          <Button
            type="submit"
            variant="primary"
            icon={Search}
            loading={isLoading}
            disabled={isLoading || !query.trim()}
            className="w-full"
          >
            {isLoading ? "Searching…" : "Search"}
          </Button>
        </div>
      </div>

      {/* Quick Filters */}
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-gray-700">
          Quick dietary filters
        </legend>
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map((filter) => (
            <Chip
              key={filter.value}
              selected={selectedFilters.includes(filter.value)}
              onToggle={() => toggleFilter(filter.value)}
              showCheck
            >
              {filter.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      {/* Allergies */}
      <div>
        {/* A visible heading, because without one the input read as an
            unexplained box floating between two labelled sections. The Field's
            own label stays hidden so the control is still named for
            assistive tech without repeating this heading. */}
        <p className="mb-2 text-xs font-medium text-gray-700">Allergies</p>
        <div className="flex flex-wrap items-center gap-2">
          {allergies.map((allergy) => (
            <Badge key={allergy} tone="danger">
              {allergy}
              <button
                type="button"
                onClick={() =>
                  setAllergies((prev) => prev.filter((a) => a !== allergy))
                }
                className="-mr-0.5 ml-0.5 rounded text-danger-600 hover:text-danger-800"
                aria-label={`Remove ${allergy}`}
              >
                <X size={ICON_SM} {...iconProps} />
              </button>
            </Badge>
          ))}
          <Field label="Allergies" labelHidden className="min-w-0">
            {(field) => (
              <Input
                {...field}
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
                placeholder="Allergies — e.g. peanuts, press Enter"
                className="w-64"
              />
            )}
          </Field>
        </div>
        {allergies.length > 0 && (
          <Alert tone="danger" icon={SafetyIcon} className="mt-3">
            OpenStreetMap has no allergen or cross-contamination data, so we
            cannot verify allergy safety. We use this only to surface contact
            details so you can call ahead — always tell staff directly.
          </Alert>
        )}
      </div>

      {/* Example Prompts */}
      <div>
        <p className="mb-2 text-xs font-medium text-gray-700">Try one of these</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handlePromptClick(prompt)}
              className="group flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-xs text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
            >
              {prompt}
              <ArrowUpRight
                size={ICON_SM}
                className="mt-0.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500"
                {...iconProps}
              />
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
