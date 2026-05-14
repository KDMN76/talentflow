"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { PieBlockConfig, PieResult } from "@/lib/types/reports";
import { SERIES_COLORS } from "./colors";

export interface PieBlockProps {
  title?: string;
  config: PieBlockConfig;
  result?: PieResult;
  placeholder?: boolean;
}

export function PieBlock({ title, result, placeholder }: PieBlockProps) {
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
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={result.slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={92}
              label={(p) => {
                const x = p as unknown as { name: string; percentage: number };
                return `${x.percentage.toFixed(0)}%`;
              }}
              labelLine={{ stroke: "#d4d4d8", strokeWidth: 1 }}
            >
              {result.slices.map((_, idx) => (
                <Cell
                  key={idx}
                  fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const v = typeof value === "number" ? value : Number(value ?? 0);
                const p = (item as unknown as { payload?: { name: string; percentage: number } })?.payload;
                return [
                  `${new Intl.NumberFormat("nl-NL").format(v)} (${p?.percentage.toFixed(1) ?? 0}%)`,
                  p?.name ?? "",
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
