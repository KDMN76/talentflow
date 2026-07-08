import type { ChartResult } from "@/lib/types/reports";

/**
 * Flatten the backend ChartResult (`points: [{ x, values }]`) into the flat
 * row shape recharts expects: [{ x, "Serie A": 12, "Serie B": 4 }, ...].
 */
export function chartResultToRows(
  result: ChartResult
): Array<Record<string, string | number | null>> {
  return result.points.map((p) => ({ x: p.x, ...p.values }));
}
