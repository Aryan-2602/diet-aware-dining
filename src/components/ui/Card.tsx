/**
 * A surface.
 *
 * Cards are defined by a border, not a shadow. That is the rule that retires
 * the old sm/md/lg/2xl free-for-all, where four different elevations sat on
 * visually identical containers across five files.
 *
 * `className` is for layout only. See Button for why.
 */
import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-4 sm:p-6",
} as const;

export function Card({
  as: Tag = "div",
  padding = "md",
  interactive = false,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  padding?: keyof typeof PADDING;
  /** Adds a hover affordance. Border, not elevation. */
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Tag
      className={cn(
        "rounded-xl border border-gray-200 bg-white",
        PADDING[padding],
        interactive && "transition-colors hover:border-gray-300",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
