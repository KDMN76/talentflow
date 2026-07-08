"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { PieBlock as PieBlockConfig, PieResult } from "@/lib/types/reports";
import { SERIES_COLORS } from "./colors";

export interface PieBlockProps {
  title?: string;
  config: PieBlockConfig;
  result?: PieResult;
  placeholder?: boolean;
}

export function PieBlock({ title, result, placeholder }: PieBlockProps) {
  const slices = result?.slices ?? [];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {title && (
        <p className="mb-3 px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
      )}
      {placeholder || !result ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Voer rapport uit om data te tonen
        </div>
      ) : slices.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Geen data in de gekozen periode
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={slices as Array<{ label: string; value: number; pct: number | null }>}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={92}
              label={(p) => {
                const x = p as unknown as { pct: number | null };
                return x.pct !== null ? `${x.pct.toFixed(0)}%` : "";
              }}
              labelLine={{ stroke: "#d4d4d8", strokeWidth: 1 }}
            >
              {slices.map((_, idx) => (
                <Cell
                  key={idx}
                  fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const v = typeof value === "number" ? value : Number(value ?? 0);
                const p = (item as unknown as { payload?: { label: string; pct: number | null } })?.payload;
                return [
                  `${new Intl.NumberFormat("nl-NL").format(v)}${
                    p?.pct !== null && p?.pct !== undefined ? ` (${p.pct.toFixed(1)}%)` : ""
                  }`,
                  p?.label ?? "",
                ];
              }}
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e4e4e7",
                fontSize: "12px",
              }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: "#71717a" }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
