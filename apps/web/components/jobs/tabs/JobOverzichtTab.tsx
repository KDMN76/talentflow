"use client";

import { Activity, ArrowDown, FileText, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobFunnel, useJobHealth } from "@/hooks/useJobDetail";
import { cn } from "@/lib/utils";
import type { JobDetail as Job } from "@talentflow/contracts";

// ─── Markdown renderer ──────────────────────────────────────────────────────
//
// Lightweight Markdown renderer — supports headings (`#`/`##`/`###`),
// bullet lists (`- `) and paragraphs. We deliberately avoid pulling in a full
// markdown library to keep the bundle small; the JD field is unlikely to need
// more than this in practice.

function renderMarkdown(input: string): JSX.Element[] {
  const lines = input.split(/\r?\n/);
  const blocks: JSX.Element[] = [];
  let listItems: string[] = [];
  let para: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul
          key={`list-${key++}`}
          className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300"
        >
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push(
        <p
          key={`p-${key++}`}
          className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
        >
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("### ")) {
      flushList();
      flushPara();
      blocks.push(
        <h4
          key={`h-${key++}`}
          className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {line.slice(4)}
        </h4>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      flushPara();
      blocks.push(
        <h3
          key={`h-${key++}`}
          className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith("# ")) {
      flushList();
      flushPara();
      blocks.push(
        <h2
          key={`h-${key++}`}
          className="mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-100"
        >
          {line.slice(2)}
        </h2>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      flushPara();
      listItems.push(line.slice(2));
    } else if (line === "") {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return blocks;
}

/** Bold (`**text**`) and italic (`*text*`) inline markdown. */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIdx = match.index + token.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const REMOTE_COPY: Record<string, string> = {
  onsite: "Op kantoor",
  hybrid: "Hybride",
  remote: "Remote",
};

const CONTRACT_COPY: Record<string, string> = {
  fulltime: "Fulltime",
  parttime: "Parttime",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Stage",
};

const EXPERIENCE_COPY: Record<string, string> = {
  intern: "Stagiair",
  junior: "Junior",
  medior: "Medior",
  senior: "Senior",
  lead: "Lead",
  director: "Director",
};

const FREQUENCY_COPY: Record<string, string> = {
  hourly: "per uur",
  monthly: "per maand",
  yearly: "per jaar",
};

function formatDateNL(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatSalaryRange(job: Job): string {
  const cur = job.currency ?? "EUR";
  const symbol = cur === "EUR" ? "€" : cur + " ";
  const fmt = (n: number) => `${symbol}${n.toLocaleString("nl-NL")}`;
  const freq = job.salary_frequency ? FREQUENCY_COPY[job.salary_frequency] ?? "" : "";
  if (job.salary_min != null && job.salary_max != null) {
    return `${fmt(job.salary_min)} – ${fmt(job.salary_max)}${freq ? ` ${freq}` : ""}`;
  }
  if (job.salary_max != null) return `${fmt(job.salary_max)}${freq ? ` ${freq}` : ""}`;
  if (job.salary_min != null) return `${fmt(job.salary_min)}${freq ? ` ${freq}` : ""}`;
  return "—";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function JobOverzichtTab({ job }: { job: Job }) {
  const { data: health, isLoading: healthLoading } = useJobHealth(job.id);
  const { data: funnel, isLoading: funnelLoading } = useJobFunnel(job.id);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ── Left: description ─────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-500" />
              Functieomschrijving
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {job.description ? (
              renderMarkdown(job.description)
            ) : (
              <p className="text-sm text-muted-foreground">
                Nog geen functieomschrijving toegevoegd.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Sub-fase 2C: `job.requirements` (frontend-fantoom) vervangen door
            de echte DB-velden `required_skills` + `nice_to_have_skills`. */}
        {(job.required_skills?.length ?? 0) > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Vereiste vaardigheden</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {(job.required_skills ?? []).map((skill, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                    {skill}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {(job.nice_to_have_skills?.length ?? 0) > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pre's</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {(job.nice_to_have_skills ?? []).map((skill, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                    {skill}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Right: snapshots + details ────────────────────────────────── */}
      <div className="space-y-6">
        {/* Health breakdown card */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              Health-breakdown
            </CardTitle>
            <CardDescription>
              Samenstelling van de health-score.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {healthLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : health ? (
              health.components.map((comp) => (
                <div key={comp.key}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">
                      {comp.label}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {comp.score}/100
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        comp.score >= 70
                          ? "bg-emerald-500"
                          : comp.score >= 40
                          ? "bg-amber-500"
                          : "bg-red-500"
                      )}
                      style={{ width: `${comp.score}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Health-data nog niet beschikbaar.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Funnel snapshot */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Funnel snapshot</CardTitle>
            <CardDescription>Verdeling per stage met conversie.</CardDescription>
          </CardHeader>
          <CardContent>
            {funnelLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : funnel && funnel.stages.length > 0 ? (
              <ol className="space-y-2">
                {funnel.stages.map((stage, i) => {
                  const isLast = i === funnel.stages.length - 1;
                  return (
                    <li key={stage.stage_id} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-700 dark:text-zinc-200">
                          {stage.name}
                        </span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                          {stage.count}
                        </span>
                      </div>
                      {!isLast && stage.conversion_to_next_pct != null && (
                        <div className="ml-1 mt-1 mb-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <ArrowDown className="h-3 w-3" />
                          <span className="font-medium">
                            {stage.conversion_to_next_pct}% door
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Geen pipeline-data beschikbaar.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Job details — Manatal-parity fields */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              Vacaturedetails
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-3 gap-y-2 text-sm sm:grid-cols-2">
              <DetailRow label="Referentie" value={job.job_reference} mono />
              {/* Sub-fase 2C: "Klant"-rij verwijderd — `job.client` was
                  fantoom-veld zonder DB-grond. Komt terug bij Clients/CRM
                  module (zie ROADMAP). */}
              <DetailRow
                label="Aantal posities"
                value={
                  job.headcount != null ? job.headcount.toString() : null
                }
              />
              <DetailRow
                label="Ervaringsniveau"
                value={
                  job.experience_level
                    ? EXPERIENCE_COPY[job.experience_level] ??
                      job.experience_level
                    : null
                }
              />
              <DetailRow
                label="Contracttype"
                value={
                  job.contract_type
                    ? CONTRACT_COPY[job.contract_type] ?? job.contract_type
                    : null
                }
              />
              <DetailRow label="Contractdetails" value={job.contract_details} />
              <DetailRow
                label="Open vanaf"
                value={formatDateNL(job.open_date)}
              />
              <DetailRow
                label="Sluitingsdatum"
                value={formatDateNL(job.close_date)}
              />
              <DetailRow label="Industrie" value={job.industry} />
              <DetailRow
                label="Werklocatie"
                value={
                  job.remote_type
                    ? REMOTE_COPY[job.remote_type] ?? job.remote_type
                    : null
                }
              />
              <DetailRow label="Kantooradres" value={job.office_address} />
              <DetailRow label="Salaris" value={formatSalaryRange(job)} />
              <DetailRow label="Valuta" value={job.currency} />
              <DetailRow
                label="Frequentie"
                value={
                  job.salary_frequency
                    ? FREQUENCY_COPY[job.salary_frequency] ??
                      job.salary_frequency
                    : null
                }
              />
              <DetailRow
                label="Pakketdetails"
                value={job.package_details}
                colSpan
              />
              {/* Sub-fase 2C: "Eigenaar"-rij verwijderd — `job.owner_name`
                  was fantoom-veld; recruiter wordt al getoond in
                  JobDetailHeader. */}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  colSpan?: boolean;
}

function DetailRow({ label, value, mono, colSpan }: DetailRowProps) {
  return (
    <div className={cn(colSpan && "sm:col-span-2")}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-sm text-zinc-900 dark:text-zinc-100 break-words",
          mono && "font-mono text-xs",
          !value && "text-muted-foreground"
        )}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
