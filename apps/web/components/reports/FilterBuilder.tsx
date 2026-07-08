"use client";

/**
 * FilterBuilder — reusable component for adding/editing filters on a block.
 *
 * Fields and operators mirror the backend whitelist (FILTERABLE_FIELDS +
 * FilterOperator in apps/api/src/lib/reports/configSchema.ts). Unknown fields
 * are silently dropped server-side, so only whitelisted fields are offered.
 *
 * Value handling per operator:
 *   - equals / gt / lt / contains → single value
 *   - in       → comma-separated input, sent as array
 *   - between  → two inputs, sent as [from, to]
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
import {
  FILTER_FIELD_OPTIONS,
  type FilterOperator,
  type ReportFilter,
} from "@/lib/types/reports";

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "is gelijk aan" },
  { value: "contains", label: "bevat" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "in", label: "in (komma-gesch.)" },
  { value: "between", label: "tussen" },
];

export interface FilterBuilderProps {
  filters: ReportFilter[];
  onChange: (next: ReportFilter[]) => void;
}

function valueAsString(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function betweenPart(value: unknown, idx: 0 | 1): string {
  if (Array.isArray(value)) return valueAsString(value[idx]);
  return "";
}

export function FilterBuilder({ filters, onChange }: FilterBuilderProps) {
  const update = (idx: number, patch: Partial<ReportFilter>) => {
    const next = [...filters];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const setOperator = (idx: number, operator: FilterOperator) => {
    const current = filters[idx];
    // Normalize value shape when the operator category changes.
    let value: unknown = current.value;
    if (operator === "between") {
      value = Array.isArray(value) ? value.slice(0, 2) : ["", ""];
    } else if (operator === "in") {
      value = Array.isArray(value) ? value : [valueAsString(value)].filter(Boolean);
    } else if (Array.isArray(value)) {
      value = valueAsString(value[0] ?? "");
    }
    update(idx, { operator, value });
  };

  const remove = (idx: number) => {
    onChange(filters.filter((_, i) => i !== idx));
  };

  const add = () => {
    onChange([
      ...filters,
      { field: FILTER_FIELD_OPTIONS[0].value, operator: "equals", value: "" },
    ]);
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
            <Select
              value={f.field}
              onValueChange={(v) => update(idx, { field: v })}
            >
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue placeholder="Veld" />
              </SelectTrigger>
              <SelectContent>
                {FILTER_FIELD_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={f.operator}
              onValueChange={(v) => setOperator(idx, v as FilterOperator)}
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
          {f.operator === "between" ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={betweenPart(f.value, 0)}
                onChange={(e) =>
                  update(idx, {
                    value: [e.target.value, betweenPart(f.value, 1)],
                  })
                }
                className="h-7 flex-1 text-xs"
                placeholder="van"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                value={betweenPart(f.value, 1)}
                onChange={(e) =>
                  update(idx, {
                    value: [betweenPart(f.value, 0), e.target.value],
                  })
                }
                className="h-7 flex-1 text-xs"
                placeholder="tot"
              />
            </div>
          ) : f.operator === "in" ? (
            <Input
              value={valueAsString(f.value)}
              onChange={(e) =>
                update(idx, {
                  value: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="h-7 text-xs"
              placeholder="waarde1, waarde2, …"
            />
          ) : (
            <Input
              value={valueAsString(f.value)}
              onChange={(e) => update(idx, { value: e.target.value })}
              className="h-7 text-xs"
              placeholder="waarde"
            />
          )}
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
