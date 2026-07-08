"use client";

import type {
  DimensionDef,
  MetricDef,
  PieBlock,
} from "@/lib/types/reports";
import { Field, Section, SingleSelect } from "./shared";
import { Input } from "@/components/ui/input";
import { FilterBuilder } from "../FilterBuilder";

export interface PieEditPanelProps {
  config: PieBlock;
  onChange: (next: PieBlock) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function PieEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: PieEditPanelProps) {
  const setMetric = (key: string) => {
    const m = metrics.find((x) => x.key === key);
    if (m) onChange({ ...config, metric: m });
  };

  const setGroupBy = (key: string) => {
    const d = dimensions.find((x) => x.key === key);
    if (d) onChange({ ...config, group_by: d });
  };

  return (
    <div className="space-y-4">
      <Section title="Metric">
        <Field label="Welk getal verdelen we?">
          <SingleSelect
            value={config.metric?.key ?? ""}
            onChange={setMetric}
            options={metrics.map((m) => ({ value: m.key, label: m.label }))}
          />
        </Field>
      </Section>

      <Section title="Verdeel per">
        <Field label="Dimensie">
          <SingleSelect
            value={config.group_by?.key ?? ""}
            onChange={setGroupBy}
            options={dimensions.map((d) => ({ value: d.key, label: d.label }))}
          />
        </Field>
      </Section>

      <Section title="Maximum aantal slices">
        <Input
          type="number"
          min={2}
          max={20}
          value={config.limit ?? 6}
          onChange={(e) =>
            onChange({ ...config, limit: parseInt(e.target.value, 10) || 6 })
          }
          className="h-9 text-sm"
        />
      </Section>

      <Section title="Filters">
        <FilterBuilder
          filters={config.filters ?? []}
          onChange={(filters) => onChange({ ...config, filters })}
        />
      </Section>
    </div>
  );
}
