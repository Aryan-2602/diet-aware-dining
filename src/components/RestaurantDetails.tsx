"use client";

/**
 * Everything about one restaurant, on one screen.
 *
 * This absorbed the former Evidence screen, which rendered a strict subset of
 * what this already showed — same confidence, same sub-scores, same warnings,
 * a different grouping of the same evidence array, and fewer links. The two
 * screens mostly existed to link to each other.
 */
import { ArrowLeft, Clock, Globe, Navigation, Phone } from "lucide-react";
import { useAppStore } from "@/store";
import { Alert } from "./ui/Alert";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { confidenceTier, TIER_LABEL } from "@/lib/confidence";
import { formatDistanceKm, mapsDirectionsUrl, percent } from "@/lib/format";
import {
  ExternalIcon,
  ICON_SM,
  SaveIcon,
  SavedIcon,
  UnverifiableIcon,
  VerifiedIcon,
  iconProps,
} from "@/lib/icons";

/** Full detail for `selectedRestaurant`, including its evidence breakdown. */
export function RestaurantDetails() {
  const selectedRestaurant = useAppStore((s) => s.selectedRestaurant);
  const setPage = useAppStore((s) => s.setPage);
  const saveRestaurant = useAppStore((s) => s.saveRestaurant);
  const unsaveRestaurant = useAppStore((s) => s.unsaveRestaurant);
  // Subscribes to the saved list itself, not the isRestaurantSaved getter.
  // Selecting the getter returns the same function reference on every render,
  // so zustand's Object.is check saw no change and the button never re-rendered
  // — the label stayed on "Save" after saving, and users clicked again.
  const savedRestaurants = useAppStore((s) => s.savedRestaurants);

  if (!selectedRestaurant) {
    return (
      <EmptyState
        title="No restaurant selected"
        action={
          <Button variant="secondary" icon={ArrowLeft} onClick={() => setPage("results")}>
            Back to results
          </Button>
        }
      />
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
      <Button
        variant="ghost"
        size="sm"
        icon={ArrowLeft}
        onClick={() => setPage("results")}
        className="-ml-2.5"
      >
        Back to results
      </Button>

      {/* 1. Identity, dietary tags, contact */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              {restaurant.name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {restaurant.address}
              {typeof restaurant.distance === "number" &&
                ` • ${formatDistanceKm(restaurant.distance)} away`}
            </p>
            {restaurant.cuisine.length > 0 && (
              <p className="text-sm text-gray-500 capitalize mt-0.5">
                {restaurant.cuisine.join(", ")}
              </p>
            )}
          </div>
          <Button
            variant="secondary"
            icon={isSaved ? SavedIcon : SaveIcon}
            aria-pressed={isSaved}
            onClick={handleToggleSave}
            className="flex-shrink-0"
          >
            {isSaved ? "Saved" : "Save"}
          </Button>
        </div>

        {restaurant.dietaryOptions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {restaurant.dietaryOptions.map((option) => (
              <Badge key={option} tone="verified" icon={VerifiedIcon} className="capitalize">
                {option}
              </Badge>
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
              className="inline-flex items-center gap-1.5 font-medium text-gray-700 hover:text-gray-900 hover:underline"
            >
              <Phone size={ICON_SM} {...iconProps} />
              {restaurant.phone}
            </a>
          )}
          {restaurant.website && (
            <a
              href={restaurant.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900 hover:underline"
            >
              <Globe size={ICON_SM} {...iconProps} />
              Website
            </a>
          )}
          {restaurant.openingHours && (
            <span className="inline-flex items-center gap-1.5 text-gray-500">
              <Clock size={ICON_SM} {...iconProps} />
              {restaurant.openingHours}
            </span>
          )}
          <a
            href={mapsDirectionsUrl(restaurant.location.lat, restaurant.location.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900 hover:underline"
          >
            <Navigation size={ICON_SM} {...iconProps} />
            Directions
          </a>
        </div>
      </Card>

      {/* 2. Why it matched, and what we could not check */}
      {(matchReasons.length > 0 || warnings.length > 0) && (
        <Card className="space-y-4">
          {matchReasons.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">
                Why this matched
              </h2>
              <ul className="space-y-1.5">
                {matchReasons.map((reason, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <VerifiedIcon
                      size={ICON_SM}
                      className="mt-0.5 shrink-0 text-verified-600"
                      {...iconProps}
                    />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <Alert tone="caution" title="What we could not verify">
              <ul className="space-y-1.5">
                {warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </Alert>
          )}
        </Card>
      )}

      {/* 3. Verification: score, sub-scores, and the raw OSM evidence */}
      <Card>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Verification strength
          </h2>
          {/* The bare percentage said nothing about whether it was good. */}
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums text-gray-900">
              {percent(confidence.overall)}%
            </p>
            <p className="text-xs text-gray-500">
              {TIER_LABEL[confidenceTier(confidence.overall)]}
            </p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4">
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
                  className="flex items-center justify-between gap-3 rounded-lg bg-verified-50 px-3 py-2 text-sm text-gray-700"
                >
                  <span className="flex items-center gap-2">
                    <VerifiedIcon
                      size={ICON_SM}
                      className="shrink-0 text-verified-600"
                      {...iconProps}
                    />
                    {e.claim}
                  </span>
                  <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
                    {percent(e.confidence)}%
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
                  className="flex items-center gap-2 rounded-lg bg-caution-50 px-3 py-2 text-sm text-caution-800"
                >
                  <UnverifiableIcon
                    size={ICON_SM}
                    className="shrink-0 text-caution-600"
                    {...iconProps}
                  />
                  {e.claim}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-4 text-xs">
          <a
            href={`https://www.openstreetmap.org/${restaurant.osmType}/${restaurant.osmId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-source-600 hover:text-source-700 hover:underline"
          >
            <ExternalIcon size={ICON_SM} {...iconProps} />
            Verify on OpenStreetMap
          </a>
          {/* Replaces a "Report Inaccuracy" button that had no onClick at all.
              The data is wrong *in OSM*, so the honest action is to let the
              user fix it at the source. */}
          <a
            href={`https://www.openstreetmap.org/edit?${restaurant.osmType}=${restaurant.osmId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-gray-900 hover:underline"
          >
            Something wrong? Edit it in OpenStreetMap
          </a>
        </div>
      </Card>
    </div>
  );
}

/**
 * One component of the confidence score.
 *
 * The fill is neutral ink rather than green on purpose: these are inputs to a
 * measurement, not verdicts, and colouring each one green implies every one is
 * "good". The single green judgement is the overall tier above.
 */
function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = percent(value);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-xs font-medium tabular-nums text-gray-700">
          {pct}%
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${pct} percent`}
        className="h-1.5 w-full rounded-full bg-gray-100"
      >
        <div
          className="h-1.5 rounded-full bg-gray-900/85"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
