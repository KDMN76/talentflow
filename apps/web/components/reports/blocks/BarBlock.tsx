"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartBlock, ChartResult } from "@/lib/types/reports";
import { SERIES_COLORS } from "./colors";
import { chartResultToRows } from "./chartData";

export interface BarBlockProps {
  title?: string;
  config: ChartBlock;
  result?: ChartResult;
  placeholder?: boolean;
}

export function BarBlock({ title, result, placeholder }: BarBlockProps) {
  const data = result ? chartResultToRows(result) : [];

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
      ) : data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Geen data in de gekozen periode
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis
              dataKey="x"
              tick={{ fontSize: 11, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e4e4e7",
                fontSize: "12px",
              }}
              cursor={{ fill: "#f4f4f5" }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: "#71717a" }}
            />
            {result.series_labels.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={[4, 4, 0, 0]}
                maxBarSize={42}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
