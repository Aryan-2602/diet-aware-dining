"use client";

/**
 * The app's only button.
 *
 * Replaces fourteen hand-rolled button styles, including the two that
 * disagreed about which green a primary action should be.
 *
 * `className` is for LAYOUT ONLY (margin, width, flex/grid placement). There
 * is no tailwind-merge here, so a colour or padding utility passed through it
 * wins or loses by stylesheet order rather than by intent. Use `variant` and
 * `size`.
 */
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ICON_MD, ICON_SM, iconProps } from "@/lib/icons";

type Variant = "primary" | "secondary" | "ghost" | "danger-ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  // Actions are ink. Colour in this app is reserved for what we can verify.
  primary:
    "bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500",
  secondary:
    "bg-white text-gray-800 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 disabled:text-gray-400",
  ghost:
    "text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:text-gray-400",
  "danger-ghost": "text-gray-500 hover:text-danger-600 hover:bg-danger-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

type Common = {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  loading?: boolean;
  /** Layout utilities only — never colour or padding. */
  className?: string;
};

/**
 * Labelling is enforced by the compiler: a button either renders children, or
 * it is icon-only and must carry an aria-label. `tsc --noEmit` catches the
 * omission, so an unlabelled icon button cannot reach review.
 */
type Labelled =
  | { children: React.ReactNode; "aria-label"?: string }
  | { children?: never; "aria-label": string };

type ButtonProps = Common &
  Labelled &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

type LinkProps = Common &
  Labelled & { href: string } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    "className" | "children" | "href"
  >;

const BASE =
  "inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed";

export function Button(props: ButtonProps | LinkProps) {
  const {
    variant = "secondary",
    size = "md",
    icon: Icon,
    iconPosition = "left",
    loading = false,
    className,
    children,
    ...rest
  } = props as Common & Labelled & { href?: string } & Record<string, unknown>;

  const iconSize = size === "sm" ? ICON_SM : ICON_MD;
  const content = (
    <>
      {Icon && iconPosition === "left" && (
        <Icon size={iconSize} className={loading ? "animate-spin" : undefined} {...iconProps} />
      )}
      {children}
      {Icon && iconPosition === "right" && (
        <Icon size={iconSize} className={loading ? "animate-spin" : undefined} {...iconProps} />
      )}
    </>
  );

  const classes = cn(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    // Icon-only buttons stay square rather than inheriting text padding.
    !children && (size === "sm" ? "w-8 px-0" : "w-9 px-0"),
    className
  );

  if (typeof (rest as { href?: string }).href === "string") {
    const { href, ...anchorRest } = rest as { href: string };
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        {...anchorRest}
      >
        {content}
      </a>
    );
  }

  return (
    <button className={classes} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {content}
    </button>
  );
}
