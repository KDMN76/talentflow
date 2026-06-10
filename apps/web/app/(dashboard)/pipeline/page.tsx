"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Kanban, ArrowRight, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useJobs } from "@/hooks/useJobs";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  draft: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  filled: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400",
  closed: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
};

export default function PipelinePage() {
  const { t } = useTranslation("pipeline");
  const { data: jobs, isLoading } = useJobs("all");

  const openJobs = jobs?.filter((j) => j.status === "open") ?? [];
  const otherJobs = jobs?.filter((j) => j.status !== "open") ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={t("title")} description={t("selectJob")} />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : jobs?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Kanban className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {t("empty.title")}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {t("empty.description")}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {openJobs.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 px-1">
                {t("sections.openJobs")}
              </h2>
              <div className="space-y-2">
                {openJobs.map((job) => (
                  <PipelineJobRow key={job.id} job={job} />
                ))}
              </div>
            </section>
          )}

          {otherJobs.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 px-1">
                {t("sections.otherJobs")}
              </h2>
              <div className="space-y-2">
                {otherJobs.map((job) => (
                  <PipelineJobRow key={job.id} job={job} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

type PipelineJobRowJob = {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  status: string;
  application_count: number;
  recruiter_name: string | null;
};

function PipelineJobRow({ job }: { job: PipelineJobRowJob }) {
  const { t } = useTranslation("pipeline");

  // Sub-fase 2C: department / location / recruiter_name zijn nullable na de
  // shared-contracts migratie. Filter null-onderdelen uit de meta-regel zodat
  // we niet "null · null · null" tonen voor jobs zonder die hydration.
  const metaParts = [job.department, job.location, job.recruiter_name].filter(
    (s): s is string => Boolean(s)
  );

  return (
    <Link
      href={`/jobs/${job.id}/pipeline`}
      className="group flex items-center gap-4 rounded-xl border border-border bg-white dark:bg-zinc-900 px-4 py-3.5 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800 transition-all duration-150"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/40">
        <Kanban className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {job.title}
          </p>
          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0", STATUS_COLOR[job.status])}>
            {t(`status.${job.status}`, { defaultValue: job.status })}
          </span>
        </div>
        {metaParts.length > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {metaParts.join(" · ")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>{job.application_count}</span>
      </div>

      <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  );
}
