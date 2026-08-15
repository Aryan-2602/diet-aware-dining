"use client";

/**
 * Mobile bottom tabs. Hidden on `md+` (desktop uses the header in page.tsx).
 * Active item is Zustand `currentPage`, not the URL.
 */
import { Bookmark, Home, MapPin, Search } from "lucide-react";
import { ICON_LG, iconProps } from "@/lib/icons";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store";

const NAV_ITEMS = [
  { page: "landing" as const, label: "Home", Icon: Home },
  { page: "search" as const, label: "Search", Icon: Search },
  { page: "results" as const, label: "Results", Icon: MapPin },
  { page: "saved" as const, label: "Saved", Icon: Bookmark },
];

/** Fixed bottom nav for small screens. */
export function Navigation() {
  const currentPage = useAppStore((s) => s.currentPage);
  const setPage = useAppStore((s) => s.setPage);

  return (
    <nav
      aria-label="Primary"
      // The inset padding keeps the tabs clear of the home indicator on
      // iOS rather than sitting under it.
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-md items-center justify-around">
        {NAV_ITEMS.map(({ page, label, Icon }) => {
          const isActive = currentPage === page;
          return (
            <button
              key={page}
              onClick={() => setPage(page)}
              // Announced as the current page, not just coloured differently.
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // 44px minimum touch target.
                "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors",
                isActive ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
              )}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-gray-900"
                />
              )}
              <Icon size={ICON_LG} {...iconProps} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
