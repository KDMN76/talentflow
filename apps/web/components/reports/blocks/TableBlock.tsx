"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TableBlock as TableBlockConfig, TableResult } from "@/lib/types/reports";

export interface TableBlockProps {
  title?: string;
  config: TableBlockConfig;
  result?: TableResult;
  placeholder?: boolean;
}

type SortDir = "asc" | "desc" | null;

function formatCell(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return new Intl.NumberFormat("nl-NL").format(v);
  return v;
}

/**
 * Renders the backend TableResult: `headers` (labels in render order) +
 * `rows` (array-of-arrays, dimension cells first, metric value(s) last).
 * Client-side re-sorting on any column.
 */
export function TableBlock({ title, result, placeholder }: TableBlockProps) {
  const [sortIdx, setSortIdx] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const sortedRows = useMemo(() => {
    const rows = result?.rows ?? [];
    if (sortIdx === null || sortDir === null) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortIdx] ?? "";
      const bv = b[sortIdx] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [result, sortIdx, sortDir]);

  const toggleSort = (idx: number) => {
    if (sortIdx !== idx) {
      setSortIdx(idx);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "desc" ? "asc" : d === "asc" ? null : "desc"));
      if (sortDir === "asc") setSortIdx(null);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {title && (
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
        </div>
      )}
      {placeholder || !result ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          Voer rapport uit om data te tonen
        </div>
      ) : result.rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          Geen data in de gekozen periode
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/60 dark:bg-zinc-900/60">
              <tr>
                {result.headers.map((h, idx) => (
                  <SortableTh
                    key={`${h}-${idx}`}
                    label={h}
                    align={idx === 0 ? "left" : "right"}
                    active={sortIdx === idx}
                    dir={sortIdx === idx ? sortDir : null}
                    onClick={() => toggleSort(idx)}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sortedRows.map((row, i) => (
                <tr
                  key={i}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30"
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        "py-2.5",
                        j === 0
                          ? "pl-5 pr-4 font-medium text-zinc-700 dark:text-zinc-300"
                          : "pr-5 text-right tabular-nums text-zinc-900 dark:text-zinc-100"
                      )}
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-300",
          align === "right" && "flex-row-reverse"
        )}
      >
        {label}
        {active && dir === "asc" && <ArrowUp className="h-3 w-3" />}
        {active && dir === "desc" && <ArrowDown className="h-3 w-3" />}
        {!active && <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </button>
    </th>
  );
}
