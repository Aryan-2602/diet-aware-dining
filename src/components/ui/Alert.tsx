/**
 * A standing notice.
 *
 * **This component has no dismiss affordance, on purpose.** Two of its callers
 * are safety disclosures — that allergy information cannot be verified from
 * OpenStreetMap, and that a dietary need has no OSM tag to filter on. Those
 * must stay on screen for as long as they are true. Making dismissal
 * impossible by construction is more durable than remembering not to pass a
 * prop.
 *
 * If a future caller genuinely needs a dismissible message, that is a
 * different component.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { CautionIcon, ICON_MD, SafetyIcon, iconProps } from "@/lib/icons";
import type { Tone } from "./Badge";

const TONES: Record<Exclude<Tone, "verified">, string> = {
  danger: "bg-danger-50 border-danger-200 text-danger-900",
  caution: "bg-caution-50 border-caution-200 text-caution-900",
  neutral: "bg-gray-50 border-gray-200 text-gray-900",
};

const DEFAULT_ICON = {
  danger: SafetyIcon,
  caution: CautionIcon,
  neutral: CautionIcon,
} as const;

export function Alert({
  tone = "neutral",
  icon,
  title,
  className,
  children,
}: {
  tone?: Exclude<Tone, "verified">;
  icon?: LucideIcon;
  title?: string;
  /** Layout utilities only. */
  className?: string;
  children?: ReactNode;
}) {
  const Icon = icon ?? DEFAULT_ICON[tone];
  return (
    <div
      className={cn("rounded-lg border p-3 sm:p-4", TONES[tone], className)}
    >
      <div className="flex gap-2.5">
        <Icon size={ICON_MD} className="mt-px shrink-0" {...iconProps} />
        <div className="min-w-0 text-sm">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && "mt-1")}>{children}</div>}
        </div>
      </div>
    </div>
  );
}
