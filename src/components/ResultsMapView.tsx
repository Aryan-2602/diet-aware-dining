"use client";

/**
 * Results screen: OSM embed + ranked cards. Empty sets are not a generic
 * "try broadening" message — they use `searchMeta` to say which constraint,
 * radius, and candidate count produced zero verified matches. Allergies
 * always get a banner: OSM cannot verify them.
 */
import { useState } from "react";
import { ArrowLeft, MapPinOff, SearchX } from "lucide-react";
import { useAppStore, type SearchMeta } from "@/store";
import { RecommendationCard } from "./RecommendationCard";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { EmptyState } from "./ui/EmptyState";
import { cn } from "@/lib/cn";
import { SafetyIcon } from "@/lib/icons";
import { Recommendation } from "@/types";

type SortMode = "confidence" | "distance";

/** Map + list for the current search; reads everything from the store. */
export function ResultsMapView() {
  const recommendations = useAppStore((s) => s.recommendations);
  const mapData = useAppStore((s) => s.mapData);
  const metadata = useAppStore((s) => s.metadata);
  const parsedIntent = useAppStore((s) => s.parsedIntent);
  const searchMeta = useAppStore((s) => s.searchMeta);
  const setPage = useAppStore((s) => s.setPage);
  const [sortMode, setSortMode] = useState<SortMode>("confidence");

  const sortedRecommendations = sortResults(recommendations, sortMode);

  if (recommendations.length === 0) {
    // No search has run at all -- distinct from a search that found nothing.
    // The old copy claimed a search had failed when none was ever made.
    if (!searchMeta) {
      return (
        <EmptyState
          icon={SearchX}
          title="No search yet"
          description="Describe what you need and we'll find restaurants whose dietary tags we can actually verify."
          action={
            <Button variant="primary" onClick={() => setPage("search")}>
              Start a search
            </Button>
          }
        />
      );
    }
    return <NoMatchesState searchMeta={searchMeta} onModify={() => setPage("search")} />;
  }

  const hasMap = Boolean(mapData && mapData.markers.length > 0);

  return (
    <div className="space-y-4">
      {/* Allergies can never be verified from OpenStreetMap, so this is shown
          whenever any were given and cannot be dismissed. `Alert` has no
          dismiss affordance at all, so that stays true by construction. */}
      {parsedIntent && parsedIntent.restrictions.length > 0 && (
        <Alert
          tone="danger"
          icon={SafetyIcon}
          title="Allergy information cannot be verified"
        >
          OpenStreetMap holds no allergen or cross-contamination data. Nothing
          below has been checked for{" "}
          <span className="font-medium">
            {parsedIntent.restrictions.join(", ")}
          </span>
          . Call ahead and tell staff directly.
        </Alert>
      )}

      {searchMeta && searchMeta.unenforceableNeeds.length > 0 && (
        <Alert tone="caution">
          OpenStreetMap has no tag for{" "}
          <span className="font-medium">
            {searchMeta.unenforceableNeeds.join(", ")}
          </span>
          , so results below are filtered on{" "}
          {searchMeta.enforceableNeeds.length > 0 ? (
            <span className="font-medium">
              {searchMeta.enforceableNeeds.join(" and ")}
            </span>
          ) : (
            "location"
          )}{" "}
          only.
        </Alert>
      )}

      {/* Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          <span className="tabular-nums">{recommendations.length}</span> verified
          match
          {recommendations.length === 1 ? "" : "es"}
          {metadata && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              from <span className="tabular-nums">{metadata.candidatesScanned ?? 0}</span> places
              checked
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Sort results" className="flex items-center gap-2">
            {(
              [
                { key: "confidence", label: "Verification" },
                { key: "distance", label: "Distance" },
              ] as const
            ).map((btn) => (
              <Chip
                key={btn.key}
                selected={sortMode === btn.key}
                onToggle={() => setSortMode(btn.key)}
              >
                {btn.label}
              </Chip>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={() => setPage("search")}
            className="ml-1"
          >
            Modify
          </Button>
        </div>
      </div>

      {/* Desktop: Map + Cards side by side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {mapData && hasMap && (
          <div className="lg:sticky lg:top-20 lg:col-span-2 lg:self-start">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <iframe
                title={`Area searched near ${searchMeta?.resolvedLocation ?? "your location"}`}
                width="100%"
                height="400"
                className="block border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                // No `marker` parameter. It previously pinned mapData.center —
                // the centroid of the results — which is not a restaurant, so
                // the map showed one confident pin at a place nobody could eat.
                // OSM's embed accepts only a single marker, so there is no way
                // to plot all N here; the bbox frames the area instead and each
                // card links to its own exact location.
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapData.bounds.west},${mapData.bounds.south},${mapData.bounds.east},${mapData.bounds.north}&layer=mapnik`}
              />
            </div>
            <p className="mt-2 text-center text-xs text-gray-500">
              Area searched · <span className="tabular-nums">{mapData.markers.length}</span> result
              {mapData.markers.length === 1 ? "" : "s"} · Map data ©
              OpenStreetMap contributors
            </p>
          </div>
        )}

        <div className={cn("space-y-4", hasMap ? "lg:col-span-3" : "lg:col-span-5")}>
          {sortedRecommendations.map((rec, index) => (
            <RecommendationCard
              key={rec.restaurant.id}
              recommendation={rec}
              rank={index + 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A search that ran and found nothing.
 *
 * Deliberately a local component rather than props on the generic EmptyState:
 * the structure here is specific — which constraint, how far we looked, how
 * many places were considered, and the standing promise not to guess — and
 * forcing it through a generic shape is how copy like this gets eroded later.
 * The previous version showed "try broadening your search" identically for
 * geocode failures, rate limits and genuine emptiness.
 */
function NoMatchesState({
  searchMeta,
  onModify,
}: {
  searchMeta: SearchMeta;
  onModify: () => void;
}) {
  const needs = searchMeta.enforceableNeeds ?? [];
  const km = Math.round(searchMeta.radiusSearchedM / 1000);

  return (
    <EmptyState
      icon={MapPinOff}
      title="No verified matches"
      description={
        <>
          No restaurant within <span className="tabular-nums">{km}</span> km of{" "}
          <span className="font-medium">{searchMeta.resolvedLocation}</span>{" "}
          {needs.length > 0 ? (
            <>
              is tagged <span className="font-medium">{needs.join(" and ")}</span>{" "}
              in OpenStreetMap.
            </>
          ) : (
            "matched your search."
          )}
        </>
      }
      action={
        <Button variant="secondary" icon={ArrowLeft} onClick={onModify}>
          Modify Search
        </Button>
      }
    >
      {searchMeta.candidatesScanned > 0 && (
        <p className="mt-2 text-sm text-gray-500">
          We checked{" "}
          <span className="tabular-nums">{searchMeta.candidatesScanned}</span>{" "}
          places.
        </p>
      )}

      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
        We only show places whose dietary tags we can verify, so we would rather
        show you nothing than a guess.
      </p>

      {searchMeta.unenforceableNeeds.length > 0 && (
        <Alert tone="caution" className="mx-auto mt-5 max-w-md text-left">
          OpenStreetMap has no tag for{" "}
          <span className="font-medium">
            {searchMeta.unenforceableNeeds.join(", ")}
          </span>
          , so that part of your request could not be checked at all.
        </Alert>
      )}
    </EmptyState>
  );
}

/** Client-side reorder only — ranking from the API is already by confidence. */
function sortResults(recs: Recommendation[], mode: SortMode): Recommendation[] {
  const sorted = [...recs];
  switch (mode) {
    case "confidence":
      return sorted.sort((a, b) => b.confidence.overall - a.confidence.overall);
    case "distance":
      return sorted.sort((a, b) => (a.restaurant.distance ?? Infinity) - (b.restaurant.distance ?? Infinity));
    default:
      return sorted;
  }
}
