/**
 * The app's icon vocabulary.
 *
 * This is a semantic alias table rather than a wrapper component, and that is
 * the point: it makes it impossible for one state to end up with two glyphs.
 * Before this existed, "verified / unverified" rendered as `✓` and `◐` on the
 * results card but `✓` and `?` on the details screen -- the same distinction,
 * drawn two ways, in an app whose whole job is communicating that distinction.
 *
 * State icons must be imported from here and nowhere else. Icons that are
 * merely decorative or navigational (Phone, Clock, Home, ArrowLeft, ...) are
 * imported straight from lucide-react at the call site.
 */
export {
  Check as VerifiedIcon,
  CircleHelp as UnverifiableIcon,
  TriangleAlert as CautionIcon,
  ShieldAlert as SafetyIcon,
  Bookmark as SaveIcon,
  BookmarkCheck as SavedIcon,
  MapPin as LocationIcon,
  ExternalLink as ExternalIcon,
  Database as SourceIcon,
} from "lucide-react";

/** Matched to the type scale: 14 for `text-xs`, 16 for `text-sm`, 20 for headings. */
export const ICON_SM = 14;
export const ICON_MD = 16;
export const ICON_LG = 20;

/**
 * Spread onto every icon. lucide's default strokeWidth of 2 is heavy at 14px,
 * and icons here are always paired with a text label, so they are decorative
 * to assistive tech.
 */
export const iconProps = { strokeWidth: 1.75, "aria-hidden": true } as const;
