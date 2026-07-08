"use client";

/**
 * DateRangeSelector — maps directly onto the backend ReportDateRange union:
 *   { type: 'last_n_days', days } | { type: 'this_quarter' | ... } |
 *   { type: 'custom', from, to }
 */

import { Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { ReportDateRange } from "@/lib/types/reports";

type PresetKey =
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "custom";

const PRESET_LABELS: Record<PresetKey, string> = {
  last_7_days: "Laatste 7 dagen",
  last_30_days: "Laatste 30 dagen",
  last_90_days: "Laatste 90 dagen",
  this_quarter: "Dit kwartaal",
  last_quarter: "Vorig kwartaal",
  this_year: "Dit jaar",
  last_year: "Vorig jaar",
  custom: "Aangepast",
};

function toPreset(value: ReportDateRange): PresetKey {
  switch (value.type) {
    case "last_n_days":
      if (value.days <= 7) return "last_7_days";
      if (value.days <= 30) return "last_30_days";
      return "last_90_days";
    case "custom":
      return "custom";
    default:
      return value.type;
  }
}

function fromPreset(preset: PresetKey, current: ReportDateRange): ReportDateRange {
  switch (preset) {
    case "last_7_days":
      return { type: "last_n_days", days: 7 };
    case "last_30_days":
      return { type: "last_n_days", days: 30 };
    case "last_90_days":
      return { type: "last_n_days", days: 90 };
    case "custom": {
      const today = new Date().toISOString().slice(0, 10);
      const from =
        current.type === "custom" && current.from ? current.from : today;
      const to = current.type === "custom" && current.to ? current.to : today;
      return { type: "custom", from, to };
    }
    default:
      return { type: preset };
  }
}

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
  const preset = toPreset(value);
  const isCustom = value.type === "custom";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" />
        {!compact && <span>Periode</span>}
      </div>
      <Select
        value={preset}
        onValueChange={(v) => onChange(fromPreset(v as PresetKey, value))}
      >
        <SelectTrigger className="h-9 w-[180px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PRESET_LABELS) as PresetKey[]).map((k) => (
            <SelectItem key={k} value={k}>
              {PRESET_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isCustom && value.type === "custom" && (
        <>
          <Input
            type="date"
            value={value.from?.slice(0, 10) ?? ""}
            onChange={(e) =>
              onChange({ ...value, from: e.target.value || value.from })
            }
            className="h-9 w-[140px] text-sm"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={value.to?.slice(0, 10) ?? ""}
            onChange={(e) =>
              onChange({ ...value, to: e.target.value || value.to })
            }
            className="h-9 w-[140px] text-sm"
          />
        </>
      )}
    </div>
  );
}
