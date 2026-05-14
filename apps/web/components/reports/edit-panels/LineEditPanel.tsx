"use client";

import type {
  DimensionDef,
  DimensionKey,
  LineBlockConfig,
  MetricDef,
  MetricKey,
} from "@/lib/types/reports";
import { Field, MultiSelectChips, Section, SingleSelect } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface LineEditPanelProps {
  config: LineBlockConfig;
  onChange: (next: LineBlockConfig) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function LineEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: LineEditPanelProps) {
  return (
    <div className="space-y-4">
      <Section title="X-as">
        <Field label="Dimensie (vaak: tijd)">
          <SingleSelect
            value={config.x}
            onChange={(v) => onChange({ ...config, x: v as DimensionKey })}
            options={dimensions.map((d) => ({ value: d.key, label: d.label }))}
          />
        </Field>
      </Section>

      <Section title="Series (metrics)">
        <MultiSelectChips
          values={config.series}
          onChange={(s) => onChange({ ...config, series: s as MetricKey[] })}
          options={metrics.map((m) => ({ value: m.key, label: m.label }))}
        />
      </Section>

      <Section title="Group-by (optioneel)">
        <SingleSelect
          value={config.group_by ?? "__none"}
          onChange={(v) =>
            onChange({
              ...config,
              group_by: v === "__none" ? undefined : (v as DimensionKey),
            })
          }
          options={[
            { value: "__none", label: "Geen" },
            ...dimensions.map((d) => ({ value: d.key, label: d.label })),
          ]}
        />
      </Section>

      <Section title="Filters">
        <FilterBuilder
          filters={config.filters ?? []}
          onChange={(filters) => onChange({ ...config, filters })}
          dimensions={dimensions}
        />
      </Section>
    </div>
  );
}
