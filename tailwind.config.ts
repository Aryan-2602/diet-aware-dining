import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";
import defaultTheme from "tailwindcss/defaultTheme";

/**
 * Design tokens for a restrained data tool.
 *
 * Tokens live here rather than in CSS custom properties because nothing swaps
 * at runtime -- the app is light-only. A second lookup layer would buy nothing
 * and invite exactly the drift that produced the old `bg-slate-50` /
 * `bg-gray-50` split, where the same element was given two different scales.
 *
 * The governing rule is that **colour means something**. This app's value is
 * telling someone what it can and cannot verify about their dietary needs, so
 * hue is reserved for that judgement: green for verified, amber for caution,
 * red for a safety limit, blue for provenance. Actions are ink. When green is
 * both the brand and the "high confidence" signal, the signal stops reading as
 * one.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Zinc is the same scale without the blue cast, so every existing
        // `text-gray-500` across the components sharpens with no edit.
        gray: colors.zinc,

        /** A claim OpenStreetMap confirms; confidence tier "high". Nothing else. */
        verified: colors.emerald,
        /** Tier "medium", `warnings[]`, unenforceable needs, clarification. */
        caution: colors.amber,
        /** Allergy non-verifiability, errors, destructive actions. */
        danger: colors.red,
        /** Links out to openstreetmap.org. Provenance, never state. */
        source: colors.blue,
      },

      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
      },

      // Same key names as Tailwind's defaults so no class churn -- the whole
      // app just gets denser and tighter.
      fontSize: {
        xs: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.625rem", letterSpacing: "-0.01em" }],
        "2xl": ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em" }],
        "3xl": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.125rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em" }],
      },

      // Overridden in place, so existing `rounded-2xl` cards tighten from 16px
      // to 12px without being touched.
      borderRadius: {
        DEFAULT: "0.375rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.625rem",
        "2xl": "0.75rem",
      },

      /**
       * A card is defined by its border, not a shadow -- which is what retires
       * the old sm/md/lg/2xl free-for-all on visually identical surfaces.
       * `lg` is for the sticky header and overlays; there is no `2xl`.
       */
      boxShadow: {
        sm: "0 1px 2px 0 rgb(9 9 11 / 0.05)",
        DEFAULT:
          "0 1px 3px 0 rgb(9 9 11 / 0.08), 0 1px 2px -1px rgb(9 9 11 / 0.06)",
        md: "0 1px 3px 0 rgb(9 9 11 / 0.08), 0 1px 2px -1px rgb(9 9 11 / 0.06)",
        lg: "0 4px 12px -2px rgb(9 9 11 / 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;
