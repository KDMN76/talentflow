"use client";

import { AlertTriangle, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgreementMatrix } from "@/hooks/useAgreementMatrix";
import { cn, getInitials } from "@/lib/utils";
import type {
  AgreementMatrix,
  ConsensusLevel,
} from "@/lib/types/interviews";

const CONSENSUS_LABEL: Record<ConsensusLevel, string> = {
  strong: "Sterke consensus",
  moderate: "Gematigde consensus",
  low: "Lage consensus",
};

const CONSENSUS_CLASS: Record<ConsensusLevel, string> = {
  strong:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  moderate:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  low: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

function scoreCellClass(score: number, outlier: boolean): string {
  if (outlier) {
    return "bg-amber-100 text-amber-900 ring-2 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-700";
  }
  if (score >= 4) {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (score === 3) {
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300";
  }
  return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
}

export interface AgreementMatrixViewProps {
  applicationId: string;
  /** Pass a pre-loaded matrix to skip the hook (useful for storybook). */
  matrix?: AgreementMatrix | null;
  /** Custom title for the card header. */
  title?: string;
  /** When true, render without an outer Card so the host can wrap it. */
  bare?: boolean;
}

export function AgreementMatrixView({
  applicationId,
  matrix: matrixProp,
  title = "Agreement matrix",
  bare = false,
}: AgreementMatrixViewProps) {
  const { data, isLoading } = useAgreementMatrix(
    matrixProp === undefined ? applicationId : null
  );
  const matrix = matrixProp ?? data;

  const body = (() => {
    if (isLoading && !matrix) {
      return (
        <div className="space-y-3">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      );
    }
    if (!matrix || matrix.rows.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nog geen scorecards ingeleverd. De matrix verschijnt zodra minstens
          twee interviewers hun beoordeling hebben opgeslagen.
        </div>
      );
    }
    return <MatrixTable matrix={matrix} />;
  })();

  if (bare) return body;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-500" />
          {title}
        </CardTitle>
        {matrix && matrix.rows.length > 0 && (
          <CardDescription className="flex items-center gap-2 flex-wrap">
            <span>
              {matrix.interviewers.length} interviewers · {matrix.rows.length}{" "}
              criteria
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                CONSENSUS_CLASS[matrix.overall_consensus]
              )}
            >
              {CONSENSUS_LABEL[matrix.overall_consensus]}
            </span>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">{body}</CardContent>
    </Card>
  );
}

function MatrixTable({ matrix }: { matrix: AgreementMatrix }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr>
          <th className="text-left text-muted-foreground font-medium px-2 py-2">
            Criterium
          </th>
          {matrix.interviewers.map((iv) => (
            <th
              key={iv.user_id}
              className={cn(
                "text-center text-muted-foreground font-medium px-2 py-2 align-bottom",
                iv.is_outlier && "text-amber-700 dark:text-amber-300"
              )}
            >
              <div className="flex flex-col items-center gap-1">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-[10px] font-semibold">
                    {getInitials(iv.user_name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] font-semibold flex items-center gap-1">
                  {iv.is_outlier && (
                    <AlertTriangle
                      className="h-3 w-3 text-amber-500"
                      aria-label="Outlier-interviewer"
                    />
                  )}
                  {iv.user_name}
                </span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  μ {iv.mean.toFixed(2)} · σ {iv.std_dev.toFixed(2)}
                </span>
              </div>
            </th>
          ))}
          <th className="text-center text-muted-foreground font-medium px-2 py-2">
            Gem.
          </th>
          <th className="text-center text-muted-foreground font-medium px-2 py-2">
            Range
          </th>
          <th className="text-center text-muted-foreground font-medium px-2 py-2">
            Consensus
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {matrix.rows.map((row) => {
          const isHighest =
            matrix.highest_range_criterion === row.criterion_key &&
            row.range > 0;
          return (
            <tr
              key={row.criterion_key}
              className={cn(
                isHighest &&
                  "bg-amber-50/60 dark:bg-amber-950/10 ring-1 ring-amber-200 dark:ring-amber-900/40"
              )}
            >
              <td className="px-2 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                <div className="flex items-center gap-1.5">
                  {isHighest && (
                    <AlertTriangle
                      className="h-3.5 w-3.5 text-amber-500 shrink-0"
                      aria-label="Grootste range"
                    />
                  )}
                  {row.criterion_label}
                </div>
              </td>
              {row.cells.map((cell, idx) => (
                <td key={idx} className="px-2 py-2 text-center">
                  {cell.score === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold",
                        scoreCellClass(cell.score, cell.outlier)
                      )}
                      title={cell.outlier ? "Afwijking ≥ 2 punten" : undefined}
                    >
                      {cell.score}
                    </span>
                  )}
                </td>
              ))}
              <td className="px-2 py-2 text-center font-semibold text-indigo-600 dark:text-indigo-400">
                {row.average.toFixed(2)}
              </td>
              <td className="px-2 py-2 text-center">
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold",
                    row.range >= 2
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      : row.range === 1
                        ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  )}
                >
                  {row.range > 0 ? `±${row.range}` : "—"}
                </span>
              </td>
              <td className="px-2 py-2 text-center">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    CONSENSUS_CLASS[row.consensus]
                  )}
                >
                  {CONSENSUS_LABEL[row.consensus].split(" ")[0]}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
