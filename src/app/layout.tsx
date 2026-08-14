/**
 * Next.js root layout. The only server-rendered shell; all screens live in
 * the client `page.tsx` and swap via Zustand rather than extra routes.
 */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DietaryAI - Smart Restaurant Recommendations",
  description:
    "AI-powered restaurant recommendations based on your dietary preferences",
};

/** HTML shell only; page switching happens in the client Home component. */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
