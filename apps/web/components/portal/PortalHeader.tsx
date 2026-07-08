/**
 * PortalHeader — white-label header voor het klantportaal.
 *
 * - Logo + brand-name links (geen TalentFlow-branding standaard)
 * - "Powered by TalentFlow" rechts, klein, optioneel via prop uit te zetten
 * - Mobile-first: stack op <sm, side-by-side op >=sm
 */

"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PortalHeaderProps {
  brandName?: string | null;
  logoUrl?: string | null;
  showPoweredBy?: boolean;
}

export function PortalHeader({
  brandName,
  logoUrl,
  showPoweredBy = true,
}: PortalHeaderProps) {
  const { t } = useTranslation("portalPublic");
  const displayName = brandName ?? t("header.fallbackBrand");

  return (
    <header className="sticky top-0 z-30 w-full border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/85 dark:bg-zinc-950/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            // Bewust <img> ipv next/image — logo komt van klant-CDN, geen optimisatie nodig.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={displayName}
              className="h-8 w-auto max-w-[160px] object-contain"
            />
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
              style={{
                background:
                  "linear-gradient(135deg, var(--brand-primary), var(--brand-accent))",
              }}
              aria-hidden="true"
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {displayName}
            </p>
            <p className="hidden text-[11px] text-zinc-500 dark:text-zinc-400 sm:block">
              {t("header.tagline")}
            </p>
          </div>
        </div>

        {showPoweredBy && (
          <Link
            href="https://talentflow.io"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-medium text-zinc-500 shadow-sm transition-colors hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 sm:inline-flex"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span>
              {t("header.poweredByPrefix")}{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                TalentFlow
              </span>
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
