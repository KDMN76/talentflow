/**
 * Jobs-list block — server-rendered cards linking to job-detail pages.
 *
 * Block.data may filter by `department` or limit count; otherwise we
 * render all jobs that came down with the page payload.
 */

import Link from "next/link";
import type { BlockRendererProps } from "../BlockRenderer";
import { t, pluralCount } from "../i18n";
import { employmentTypeLabel, formatSalary } from "../utils";

interface JobsListData {
  heading?: string;
  filter_department?: string;
  limit?: number;
  layout?: "cards" | "table";
}

export function PublicJobsListBlock({
  block,
  jobs,
  locale,
  slug,
}: BlockRendererProps) {
  const data = (block.data as JobsListData) ?? {};

  let filtered = jobs.slice();
  if (data.filter_department) {
    const target = data.filter_department.toLowerCase();
    filtered = filtered.filter(
      (j) => (j.department ?? "").toLowerCase() === target
    );
  }
  if (data.limit && data.limit > 0) {
    filtered = filtered.slice(0, data.limit);
  }

  return (
    <section
      id="vacatures"
      className="py-16 md:py-20 bg-zinc-50/60 scroll-mt-16"
      data-block="jobs_list"
      data-block-id={block.id}
    >
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900">
              {data.heading || t(locale, "open_positions")}
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              {pluralCount(
                locale,
                filtered.length,
                "open_positions_count_one",
                "open_positions_count_other"
              )}
            </p>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white py-16 text-center">
            <p className="text-base font-semibold text-zinc-900">
              {t(locale, "no_jobs_title")}
            </p>
            <p className="mt-2 text-sm text-zinc-600">
              {t(locale, "no_jobs_subtitle")}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((job) => {
              const salary = formatSalary(job, locale);
              const empType = employmentTypeLabel(job.employment_type, locale);
              return (
                <li key={job.id}>
                  <Link
                    href={`/careers/${encodeURIComponent(
                      slug
                    )}/jobs/${encodeURIComponent(job.id)}`}
                    className="group flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-all hover:border-[color:var(--brand-primary)] hover:shadow-md md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-zinc-900 group-hover:text-[color:var(--brand-primary)] transition-colors">
                          {job.title}
                        </h3>
                        {empType ? (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                            style={{
                              backgroundColor:
                                "color-mix(in srgb, var(--brand-primary) 12%, white)",
                              color: "var(--brand-primary)",
                            }}
                          >
                            {empType}
                          </span>
                        ) : null}
                        {job.remote ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                            {t(locale, "remote_friendly")}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                        {job.department ? <span>{job.department}</span> : null}
                        {job.location ? <span>{job.location}</span> : null}
                        {salary ? <span>{salary}</span> : null}
                      </div>
                      {job.description ? (
                        <p className="mt-3 text-sm leading-relaxed text-zinc-600 line-clamp-2">
                          {job.description}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform group-hover:scale-105"
                      style={{ backgroundColor: "var(--brand-primary)" }}
                    >
                      {t(locale, "apply_button")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
