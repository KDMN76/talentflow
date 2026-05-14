/**
 * PortalFooter — minimale footer voor het white-label portaal.
 *
 * Geeft GDPR-info + optionele "Powered by TalentFlow"-link. Geen TalentFlow-
 * branding zichtbaar als `showPoweredBy={false}`.
 */

"use client";

import Link from "next/link";

interface PortalFooterProps {
  brandName?: string | null;
  showPoweredBy?: boolean;
}

export function PortalFooter({
  brandName,
  showPoweredBy = true,
}: PortalFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 text-center text-[11px] text-zinc-500 dark:text-zinc-400 sm:flex-row sm:px-6 sm:text-left">
        <p>
          {brandName
            ? `© ${year} ${brandName} — recruitment portaal`
            : `© ${year} — recruitment portaal`}
        </p>
        <div className="flex items-center gap-4">
          <span>Veilige, vertrouwelijke verbinding</span>
          {showPoweredBy && (
            <Link
              href="https://talentflow.io"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              Powered by TalentFlow
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}
