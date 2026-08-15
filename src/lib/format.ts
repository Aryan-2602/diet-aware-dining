/**
 * Display formatting shared across screens.
 *
 * Each of these was duplicated in two or three components. The Google Maps URL
 * in particular was written out verbatim three times, so a fix to one call
 * site silently left the others behind.
 */

/** Metres to a single-decimal kilometre string, e.g. `1.2 km`. */
export function formatDistanceKm(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

/** A 0-1 score as a whole-number percentage. */
export function percent(value01: number): number {
  return Math.round(value01 * 100);
}

/**
 * Google Maps directions deep link.
 *
 * Coordinates only, and deliberately so: a name or address text search can
 * open a different restaurant that happens to share a common name, which is
 * the wrong destination to hand someone who picked a place for its dietary
 * tags. All three call sites already agreed on this; centralising them keeps
 * it that way.
 */
export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Coarse "time ago" for the recent-searches list. */
export function formatRelativeTime(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
