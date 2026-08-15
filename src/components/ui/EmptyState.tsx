/**
 * The "nothing here" state.
 *
 * Six of these existed in two different visual languages — a 60px emoji on the
 * results screen, small italic grey text on the saved screen. One treatment,
 * scaled to the surface.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ICON_LG, iconProps } from "@/lib/icons";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("py-12 text-center", className)}>
      {Icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon size={ICON_LG} className="text-gray-500" {...iconProps} />
        </div>
      )}
      <p className="text-base font-semibold text-gray-900">{title}</p>
      {description && (
        <div className="mx-auto mt-1.5 max-w-md text-sm text-gray-600">
          {description}
        </div>
      )}
      {children}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
