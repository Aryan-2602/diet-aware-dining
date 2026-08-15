/**
 * Next.js root layout. The only server-rendered shell; all screens live in
 * the client `page.tsx` and swap via Zustand rather than extra routes.
 */
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Variable font, self-hosted by next/font: one file covers 400/500/600, and it
// carries real tabular figures -- which the confidence percentages, score bars
// and distances rely on to stop digits shifting as results re-sort.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  // The product is "Dietary Maps AI" everywhere else; this said "DietaryAI".
  title: "Dietary Maps AI — verified dietary restaurant search",
  description:
    "Restaurant search filtered on OpenStreetMap dietary tags, with the evidence behind every match shown.",
};

/** HTML shell only; page switching happens in the client Home component. */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      {/* No background here: the canvas is declared once, in globals.css. */}
      <body className="min-h-screen">
        {/* First focusable element on the page, so keyboard users can skip the
            header and both navs. Visible only once focused. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
