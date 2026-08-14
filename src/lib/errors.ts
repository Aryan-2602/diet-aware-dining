/**
 * Typed failures for the discovery path.
 *
 * The previous code returned `[]` for every failure — a geocode miss, an
 * Overpass 504, a rate limit, and a genuinely empty result set were all
 * indistinguishable, and the API reported every one of them as
 * `status: "complete"` with zero results. These types exist so each outcome can
 * reach the user as itself.
 */

export type DiscoveryErrorCode =
  | "geocode_failed"
  | "geocode_unavailable"
  | "overpass_unavailable"
  | "overpass_timeout";

export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;

  constructor(code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
  }
}

/** The location string did not resolve to anywhere real. User-fixable. */
export class GeocodeFailedError extends DiscoveryError {
  constructor(location: string) {
    super("geocode_failed", `Could not find a place called "${location}"`);
  }
}
