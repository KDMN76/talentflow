"use client";

/**
 * FilterBuilder — reusable component for adding/editing filters on a block.
 *
 * Each filter has: field (free-form for now), operator, value (string).
 * For MVP we keep this simple — the backend dimension/metric catalogue can
 * later replace the free-form input with a dropdown of valid fields.
 */

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DimensionDef,
  FilterOperator,
  ReportFilter,
} from "@/lib/types/reports";

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "eq", label: "is gelijk aan" },
  { value: "neq", label: "is niet" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "in", label: "in (komma-gesch.)" },
  { value: "nin", label: "niet in" },
  { value: "contains", label: "bevat" },
];

export interface FilterBuilderProps {
  filters: ReportFilter[];
  onChange: (next: ReportFilter[]) => void;
  dimensions?: DimensionDef[];
}

export function FilterBuilder({
  filters,
  onChange,
  dimensions,
}: FilterBuilderProps) {
  const update = (idx: number, patch: Partial<ReportFilter>) => {
    const next = [...filters];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const remove = (idx: number) => {
    onChange(filters.filter((_, i) => i !== idx));
  };

  const add = () => {
    const firstDim = dimensions?.[0]?.key ?? "";
    onChange([...filters, { field: firstDim, operator: "eq", value: "" }]);
  };

  return (
    <div className="space-y-2">
      {filters.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Geen filters. Klik hieronder om er een toe te voegen.
        </p>
      )}
      {filters.map((f, idx) => (
        <div
          key={idx}
          className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-zinc-50/40 p-2 dark:border-zinc-800 dark:bg-zinc-900/40"
        >
          <div className="flex items-center gap-1.5">
            {dimensions && dimensions.length > 0 ? (
              <Select
                value={f.field}
                onValueChange={(v) => update(idx, { field: v })}
              >
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue placeholder="Veld" />
                </SelectTrigger>
                <SelectContent>
                  {dimensions.map((d) => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={f.field}
                onChange={(e) => update(idx, { field: e.target.value })}
                className="h-7 flex-1 text-xs"
                placeholder="veld"
              />
            )}
            <Select
              value={f.operator}
              onValueChange={(v) => update(idx, { operator: v as FilterOperator })}
            >
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Verwijder filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Input
            value={String(f.value ?? "")}
            onChange={(e) => update(idx, { value: e.target.value })}
            className="h-7 text-xs"
            placeholder="waarde"
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={add}
        className="h-7 w-full gap-1 text-xs"
      >
        <Plus className="h-3 w-3" />
        Filter toevoegen
      </Button>
    </div>
  );
}
