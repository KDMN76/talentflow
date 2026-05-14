"use client";

import type {
  DimensionDef,
  KpiBlockConfig,
  MetricDef,
} from "@/lib/types/reports";
import { Field, Section, SingleSelect } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface KpiEditPanelProps {
  config: KpiBlockConfig;
  onChange: (next: KpiBlockConfig) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function KpiEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: KpiEditPanelProps) {
  return (
    <div className="space-y-4">
      <Section title="Metric">
        <Field label="Welk getal toon je?">
          <SingleSelect
            value={config.metric}
            onChange={(v) =>
              onChange({ ...config, metric: v as KpiBlockConfig["metric"] })
            }
            options={metrics.map((m) => ({ value: m.key, label: m.label }))}
          />
        </Field>
      </Section>

      <Section title="Vergelijking">
        <Field label="Toon verandering vs.">
          <SingleSelect
            value={config.comparison ?? "none"}
            onChange={(v) =>
              onChange({
                ...config,
                comparison: v as KpiBlockConfig["comparison"],
              })
            }
            options={[
              { value: "none", label: "Geen vergelijking" },
              { value: "previous_period", label: "Vorige periode" },
              { value: "previous_year", label: "Vorig jaar" },
            ]}
          />
        </Field>
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
