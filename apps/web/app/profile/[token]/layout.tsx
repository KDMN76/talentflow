/**
 * Profile (kandidaat-self-service) layout — AVG art. 15-17.
 *
 * Dit is een PUBLIC layout (geen dashboard-chrome) voor het kandidaat-zelf-
 * service-portaal. Bewust géén tenant-branding zodat de kandidaat een neutrale,
 * generieke "Mijn gegevens"-ervaring krijgt.
 *
 * - Generieke header met TalentFlow-mini-logo + "Jouw gegevens bij {tenant.name}"
 * - Footer met privacy-policy-link + "Powered by TalentFlow"
 * - <meta robots noindex> — kandidaat-data mag NOOIT in zoekmachines
 *
 * Note: het echte <html>/<body>-element komt van app/layout.tsx (Next App Router
 * laat slechts één root toe). Wij wrappen alleen de inhoud.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "Mijn gegevens — TalentFlow",
  description:
    "Bekijk, corrigeer, of verwijder de gegevens die het recruitment-team over jou heeft.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
};

interface LayoutProps {
  children: React.ReactNode;
  params: { token: string };
}

export default function ProfileLayout({ children, params }: LayoutProps) {
  return (
    <div
      data-self-service-scope="true"
      className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950"
    >
      <ProfileHeader />
      <main className="flex-1">{children}</main>
      <ProfileFooter token={params.token} />
    </div>
  );
}

function ProfileHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-zinc-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:border-zinc-800/80 dark:bg-zinc-950/85">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
            style={{
              background:
                "linear-gradient(135deg, #6366f1, #8b5cf6)",
            }}
            aria-hidden="true"
          >
            TF
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Mijn gegevens
            </p>
            <p className="hidden text-[11px] text-zinc-500 dark:text-zinc-400 sm:block">
              Beveiligd kandidaat-portaal
            </p>
          </div>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-medium text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 sm:inline-flex">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          <span>
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
              TalentFlow
            </span>{" "}
            Privacy Portal
          </span>
        </span>
      </div>
    </header>
  );
}

function ProfileFooter({ token }: { token: string }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-zinc-200 bg-white/50 dark:border-zinc-800 dark:bg-zinc-950/50">
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 px-4 py-6 text-center text-[11px] text-zinc-500 dark:text-zinc-400 sm:flex-row sm:px-6 sm:text-left">
        <p>© {year} — Beveiligd kandidaat-portaal</p>
        <div className="flex items-center gap-4">
          <Link
            href={`/profile/${token}/privacy`}
            className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Privacy­beleid
          </Link>
          <span>Powered by TalentFlow</span>
        </div>
      </div>
    </footer>
  );
}
