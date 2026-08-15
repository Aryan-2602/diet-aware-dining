"use client";

/**
 * One verified restaurant. Evidence quotes are omitted when none exist —
 * never fabricated. The OSM verify link uses `osmType`/`osmId`, not a
 * name search, so it opens the exact mapped object.
 */
import { ChevronRight, Navigation } from "lucide-react";
import { Recommendation } from "@/types";
import { useAppStore } from "@/store";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { cn } from "@/lib/cn";
import { confidenceTier, evidenceTier, TIER_TONE } from "@/lib/confidence";
import { formatDistanceKm, mapsDirectionsUrl, percent } from "@/lib/format";
import {
  CautionIcon,
  ExternalIcon,
  ICON_SM,
  SaveIcon,
  SavedIcon,
  SourceIcon,
  UnverifiableIcon,
  VerifiedIcon,
  iconProps,
} from "@/lib/icons";

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
  const saveRestaurant = useAppStore((s) => s.saveRestaurant);
  const unsaveRestaurant = useAppStore((s) => s.unsaveRestaurant);
  const savedRestaurants = useAppStore((s) => s.savedRestaurants);
  const setPage = useAppStore((s) => s.setPage);
  const isSaved = savedRestaurants.some((s) => s.id === restaurant.id);

  const confidencePercent = percent(confidence.overall);
  const tier = confidenceTier(confidence.overall);

  const googleMapsUrl = mapsDirectionsUrl(
    restaurant.location.lat,
    restaurant.location.lng
  );

  // Only ever a real, verified claim. When there is none, nothing is shown —
  // the previous fallback fabricated a quotation and styled it as sourced.
  const evidenceQuote = evidence.find((e) => e.verified)?.claim ?? null;

  const distanceText = restaurant.distance
    ? formatDistanceKm(restaurant.distance)
    : "";

  const openDetails = () => {
    setSelectedRestaurant(recommendation);
    setPage("details");
  };

  return (
    <Card padding="sm" interactive>
      {/* Top Row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium tabular-nums text-gray-600">
            {rank}
          </span>
          <div className="min-w-0">
            <button
              onClick={openDetails}
              className="block truncate text-left text-base font-semibold text-gray-900 transition-colors hover:text-gray-600"
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
        <Badge tone={TIER_TONE[tier]} className="flex-shrink-0 tabular-nums">
          {confidencePercent}% verified
        </Badge>
      </div>

      {/* Dietary Tags */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {restaurant.dietaryOptions.map((opt) => (
          // Check prefixed, matching the details screen. It used to be a
          // suffix here and a prefix there, for the same claim.
          <Badge key={opt} tone="verified" icon={VerifiedIcon}>
            {opt}
          </Badge>
        ))}
        {matchReasons.slice(0, 2).map((reason, i) => (
          <span key={i} className="text-xs text-gray-500">
            • {reason}
          </span>
        ))}
      </div>

      {/* Evidence Quote — omitted entirely when there is nothing to quote */}
      {evidenceQuote && (
        <p className="mt-3 border-l-2 border-gray-200 bg-gray-50 py-2 pl-3 text-sm leading-relaxed text-gray-600">
          {evidenceQuote}
        </p>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {warnings.map((warning, i) => (
            <p
              key={i}
              className="flex items-center gap-1.5 text-xs text-caution-700"
            >
              <CautionIcon size={ICON_SM} {...iconProps} />
              {warning}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            // A star reads as a rating in a food app, and ratings were
            // deliberately removed from the data model as fabricated.
            icon={isSaved ? SavedIcon : SaveIcon}
            aria-pressed={isSaved}
            onClick={() =>
              isSaved
                ? unsaveRestaurant(restaurant.id)
                : saveRestaurant(recommendation)
            }
          >
            {isSaved ? "Saved" : "Save"}
          </Button>
          <Button variant="ghost" size="sm" onClick={openDetails}>
            Details
          </Button>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={Navigation}
          href={googleMapsUrl}
        >
          Open in Maps
        </Button>
      </div>

      {/* Data Sources Expandable */}
      <details className="group mt-3 border-t border-gray-100 pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            size={ICON_SM}
            className="transition-transform group-open:rotate-90"
            {...iconProps}
          />
          <SourceIcon size={ICON_SM} {...iconProps} />
          Sources ({evidence.length} evidence points)
        </summary>
        <div className="mt-3 space-y-3 pl-5">
          {/* One line, not a paragraph. This block rendered once per card, so
              ten results meant ten copies of the same explanation; the full
              text lives in the footer. */}
          <p className="text-xs text-gray-500">
            Tagged by OpenStreetMap contributors
          </p>

          {/* Evidence list */}
          {evidence.map((e, i) => {
            const eTier = evidenceTier(e.confidence);
            return (
              <div
                key={i}
                className="flex items-center justify-between gap-3 py-0.5 text-xs"
              >
                <span className="flex items-center gap-1.5 text-gray-600">
                  {e.verified ? (
                    <VerifiedIcon
                      size={ICON_SM}
                      className="shrink-0 text-verified-600"
                      {...iconProps}
                    />
                  ) : (
                    <UnverifiableIcon
                      size={ICON_SM}
                      className="shrink-0 text-caution-600"
                      {...iconProps}
                    />
                  )}
                  {e.claim}
                </span>
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    eTier === "high"
                      ? "text-verified-700"
                      : eTier === "medium"
                      ? "text-caution-700"
                      : "text-gray-500"
                  )}
                >
                  {percent(e.confidence)}%
                </span>
              </div>
            );
          })}

          {/* Verify link */}
          <div className="flex items-center gap-3 border-t border-gray-100 pt-2">
            <a
              href={`https://www.openstreetmap.org/${restaurant.osmType}/${restaurant.osmId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-source-600 hover:text-source-700 hover:underline"
            >
              <ExternalIcon size={ICON_SM} {...iconProps} />
              Verify on OpenStreetMap
            </a>
            <a
              href="https://wiki.openstreetmap.org/wiki/Key:diet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-gray-900 hover:underline"
            >
              How OSM dietary tags work
            </a>
          </div>
        </div>
      </details>
    </Card>
  );
}
