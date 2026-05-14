"use client";

import { Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { DateRangePreset, ReportDateRange } from "@/lib/types/reports";

const PRESET_LABELS: Record<DateRangePreset, string> = {
  last_7_days: "Laatste 7 dagen",
  last_30_days: "Laatste 30 dagen",
  this_quarter: "Dit kwartaal",
  this_year: "Dit jaar",
  custom: "Aangepast",
};

export interface DateRangeSelectorProps {
  value: ReportDateRange;
  onChange: (next: ReportDateRange) => void;
  compact?: boolean;
}

export function DateRangeSelector({
  value,
  onChange,
  compact,
}: DateRangeSelectorProps) {
  const isCustom = value.preset === "custom";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" />
        {!compact && <span>Periode</span>}
      </div>
      <Select
        value={value.preset}
        onValueChange={(v) =>
          onChange({ ...value, preset: v as DateRangePreset })
        }
      >
        <SelectTrigger className="h-9 w-[180px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PRESET_LABELS) as DateRangePreset[]).map((k) => (
            <SelectItem key={k} value={k}>
              {PRESET_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isCustom && (
        <>
          <Input
            type="date"
            value={value.from?.slice(0, 10) ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                from: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-9 w-[140px] text-sm"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={value.to?.slice(0, 10) ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                to: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-9 w-[140px] text-sm"
          />
        </>
      )}
    </div>
  );
}
