"use client";

/**
 * Public embed view for a report.
 *
 * Accessible at /embed/reports/[token] without auth. No TalentFlow chrome —
 * just the report itself. Robots: noindex (set in metadata via sibling
 * route layout).
 */

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, Loader2, Zap } from "lucide-react";
import { useEmbedReport } from "@/hooks/useReports";
import { BlockRenderer } from "@/components/reports/blocks/BlockRenderer";
import type { BlockResult } from "@/lib/types/reports";

export default function EmbedReportPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const { data, isLoading, isError } = useEmbedReport(token);

  // Tell crawlers to skip — we set the robots meta via document head as a
  // belt-and-braces measure (the route's metadata also sets robots:noindex).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <AlertCircle className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-base font-semibold">Rapport niet beschikbaar</p>
        <p className="mt-1 text-sm text-muted-foreground">
          De link is verlopen, ingetrokken of ongeldig.
        </p>
      </div>
    );
  }

  const { report, config, results, ran_at } = data;
  const ts = new Date(ran_at).toLocaleString("nl-NL");

  // Build a result-by-block map for the renderer.
  const byId: Record<string, BlockResult> = {};
  results.forEach((b) => {
    byId[b.block_id] = b;
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Mini header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
            <Zap className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            TalentFlow
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            Powered by TalentFlow Reports
          </span>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {report.name}
          </h1>
          {report.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {report.description}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Laatst bijgewerkt: {ts}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {config.blocks.map((entry) => (
            <div
              key={entry.id}
              className={
                // Entry-size bepaalt de breedte: sm = 1 kolom (KPI's),
                // md = 2, lg = volle breedte (charts/tabellen/funnels).
                entry.size === "sm"
                  ? "col-span-1"
                  : entry.size === "md"
                    ? "md:col-span-2 xl:col-span-2"
                    : "md:col-span-2 xl:col-span-3"
              }
            >
              <BlockRenderer entry={entry} result={byId[entry.id]} />
            </div>
          ))}
        </div>

        {config.blocks.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white/60 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Dit rapport bevat nog geen blokken
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              De eigenaar heeft het rapport nog niet ingericht.
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-12 border-t border-zinc-200 pt-6 text-center dark:border-zinc-800">
          <p className="text-[11px] text-muted-foreground">
            Dit rapport bevat geaggregeerde data — geen persoonsgegevens van
            individuele kandidaten. AI-disclosure: getallen zijn
            samengesteld uit pipeline-data; geen geautomatiseerde
            besluitvorming.
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Powered by{" "}
            <a
              href="https://talentflow.app"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-700"
            >
              TalentFlow
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
