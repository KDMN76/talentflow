"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LineBlockConfig, BarLineResult } from "@/lib/types/reports";
import { SERIES_COLORS } from "./colors";

export interface LineBlockProps {
  title?: string;
  config: LineBlockConfig;
  result?: BarLineResult;
  placeholder?: boolean;
}

export function LineBlock({ title, result, placeholder }: LineBlockProps) {
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
          <LineChart data={result.data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis
              dataKey={result.x_key}
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
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: "#71717a" }}
            />
            {result.series.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: SERIES_COLORS[i % SERIES_COLORS.length] }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
