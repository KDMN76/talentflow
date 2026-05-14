"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, ClipboardList, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const ITEMS: NavItem[] = [
  { href: "/hm", label: "Reviews", Icon: Layers },
  { href: "/hm/scorecards", label: "Scorecards", Icon: ClipboardList },
  { href: "/settings", label: "Instellingen", Icon: Settings },
];

/**
 * Bottom nav for hiring-manager mobile flows. Rendered inside the HM layout;
 * hidden on `lg+` (desktop has the regular sidebar).
 */
export function HmBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hiring manager navigatie"
      className="fixed inset-x-0 bottom-0 z-30 lg:hidden"
    >
      <div
        className="border-t border-border bg-background/95 backdrop-blur shadow-lg pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="grid grid-cols-3">
          {ITEMS.map(({ href, label, Icon }) => {
            const active =
              href === "/hm"
                ? pathname === "/hm"
                : pathname?.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={false}
                  className={cn(
                    "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] font-semibold transition-colors",
                    active
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-muted-foreground hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
