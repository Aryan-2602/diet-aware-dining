"use client";

/**
 * Mobile bottom tabs. Hidden on `md+` (desktop uses the header in page.tsx).
 * Active item is Zustand `currentPage`, not the URL.
 */
import { useAppStore } from "@/store";

/** Fixed bottom nav for small screens. */
export function Navigation() {
  const currentPage = useAppStore((s) => s.currentPage);
  const setPage = useAppStore((s) => s.setPage);

  const navItems = [
    { page: "landing" as const, label: "Home", icon: "🏠" },
    { page: "search" as const, label: "Search", icon: "🔍" },
    { page: "results" as const, label: "Results", icon: "📍" },
    { page: "evidence" as const, label: "Evidence", icon: "🛡️" },
    { page: "saved" as const, label: "Saved", icon: "💾" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
      <div className="max-w-md mx-auto flex items-center justify-around py-2">
        {navItems.map((item) => {
          const isActive = currentPage === item.page;
          return (
            <button
              key={item.page}
              onClick={() => setPage(item.page)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                isActive
                  ? "text-primary-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
