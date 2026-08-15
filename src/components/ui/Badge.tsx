/**
 * A small status label.
 *
 * `tone` is the whole point: it ties a colour to a meaning, so the same fact
 * cannot be green on one screen and grey on another. Dietary options used to
 * render as green chips on the results card and grey chips on the saved
 * screen, which quietly implied they were different kinds of claim.
 *
 * Tints only — a saturated fill would compete with the safety banners.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ICON_SM, iconProps } from "@/lib/icons";

export type Tone = "neutral" | "verified" | "caution" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700 border-gray-200",
  verified: "bg-verified-50 text-verified-800 border-verified-200",
  caution: "bg-caution-50 text-caution-800 border-caution-200",
  danger: "bg-danger-50 text-danger-800 border-danger-200",
};

export function Badge({
  tone = "neutral",
  icon: Icon,
  className,
  children,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  /** Layout utilities only. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className
      )}
    >
      {Icon && <Icon size={ICON_SM} {...iconProps} />}
      {children}
    </span>
  );
}
