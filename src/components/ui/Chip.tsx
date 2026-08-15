"use client";

/**
 * A toggle in a group — quick dietary filters, result sorting.
 *
 * Always emits `aria-pressed`. Three separate implementations of this pattern
 * existed and none of them did, so the selected state was conveyed by colour
 * alone and was invisible to a screen reader.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ICON_SM, VerifiedIcon, iconProps } from "@/lib/icons";

export function Chip({
  selected,
  onToggle,
  showCheck = false,
  className,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  /** Adds a check when selected. For filters, where the state is a claim. */
  showCheck?: boolean;
  /** Layout utilities only. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
        selected
          ? "border-gray-900 bg-gray-900 text-white"
          : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
        className
      )}
    >
      {showCheck && selected && <VerifiedIcon size={ICON_SM} {...iconProps} />}
      {children}
    </button>
  );
}
