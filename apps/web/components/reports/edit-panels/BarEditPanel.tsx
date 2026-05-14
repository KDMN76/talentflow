"use client";

import type {
  BarBlockConfig,
  DimensionDef,
  DimensionKey,
  MetricDef,
  MetricKey,
} from "@/lib/types/reports";
import { Field, MultiSelectChips, Section, SingleSelect } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface BarEditPanelProps {
  config: BarBlockConfig;
  onChange: (next: BarBlockConfig) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function BarEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: BarEditPanelProps) {
  return (
    <div className="space-y-4">
      <Section title="X-as">
        <Field label="Dimensie">
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

      <Section title="Opties">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.stacked ?? false}
            onChange={(e) =>
              onChange({ ...config, stacked: e.target.checked })
            }
            className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600"
          />
          <span className="text-zinc-700 dark:text-zinc-300">
            Gestapelde balken
          </span>
        </label>
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
