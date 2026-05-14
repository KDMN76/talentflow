"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TableBlockConfig, TableResult } from "@/lib/types/reports";

export interface TableBlockProps {
  title?: string;
  config: TableBlockConfig;
  result?: TableResult;
  placeholder?: boolean;
}

type SortDir = "asc" | "desc" | null;

export function TableBlock({ title, config, result, placeholder }: TableBlockProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const rowDimKey = config.rows[0] ?? "row";

  const sortedRows = useMemo(() => {
    if (!result || sortKey === null || sortDir === null) return result?.rows ?? [];
    return [...result.rows].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === "_label") {
        av = a.group[rowDimKey] ?? "";
        bv = b.group[rowDimKey] ?? "";
      } else {
        av = a.values[sortKey] ?? 0;
        bv = b.values[sortKey] ?? 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [result, sortKey, sortDir, rowDimKey]);

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "desc" ? "asc" : d === "asc" ? null : "desc"));
      if (sortDir === "asc") setSortKey(null);
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
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/60 dark:bg-zinc-900/60">
              <tr>
                <SortableTh
                  label={rowDimKey}
                  active={sortKey === "_label"}
                  dir={sortKey === "_label" ? sortDir : null}
                  onClick={() => toggleSort("_label")}
                />
                {result.columns.map((col) => (
                  <SortableTh
                    key={col}
                    label={col}
                    align="right"
                    active={sortKey === col}
                    dir={sortKey === col ? sortDir : null}
                    onClick={() => toggleSort(col)}
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
                  <td className="py-2.5 pl-5 pr-4 font-medium text-zinc-700 dark:text-zinc-300">
                    {row.group[rowDimKey] ?? "—"}
                  </td>
                  {result.columns.map((col) => (
                    <td
                      key={col}
                      className="py-2.5 pr-5 text-right tabular-nums text-zinc-900 dark:text-zinc-100"
                    >
                      {new Intl.NumberFormat("nl-NL").format(row.values[col] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
              {config.show_totals && result.total && (
                <tr className="border-t-2 border-zinc-200 bg-zinc-50/60 font-semibold dark:bg-zinc-900/60 dark:border-zinc-700">
                  <td className="py-2.5 pl-5 pr-4 text-zinc-900 dark:text-zinc-100">
                    Totaal
                  </td>
                  {result.columns.map((col) => (
                    <td
                      key={col}
                      className="py-2.5 pr-5 text-right tabular-nums text-zinc-900 dark:text-zinc-100"
                    >
                      {new Intl.NumberFormat("nl-NL").format(
                        result.total?.[col] ?? 0
                      )}
                    </td>
                  ))}
                </tr>
              )}
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
