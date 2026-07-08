"use client";

import type { KpiBlock, MetricDef } from "@/lib/types/reports";
import { Field, Section, SingleSelect } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface KpiEditPanelProps {
  config: KpiBlock;
  onChange: (next: KpiBlock) => void;
  metrics: MetricDef[];
}

export function KpiEditPanel({ config, onChange, metrics }: KpiEditPanelProps) {
  const setMetric = (key: string) => {
    const m = metrics.find((x) => x.key === key);
    if (m) onChange({ ...config, metric: m });
  };

  return (
    <div className="space-y-4">
      <Section title="Metric">
        <Field label="Welk getal toon je?">
          <SingleSelect
            value={config.metric?.key ?? ""}
            onChange={setMetric}
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
                comparison:
                  v === "none" ? null : (v as "previous_period" | "previous_year"),
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
        />
      </Section>
    </div>
  );
}
