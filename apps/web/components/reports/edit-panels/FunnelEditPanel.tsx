"use client";

import type {
  DimensionDef,
  FunnelBlockConfig,
  MetricDef,
  MetricKey,
} from "@/lib/types/reports";
import { Field, Section, SingleSelect, StagesEditor } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface FunnelEditPanelProps {
  config: FunnelBlockConfig;
  onChange: (next: FunnelBlockConfig) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function FunnelEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: FunnelEditPanelProps) {
  return (
    <div className="space-y-4">
      <Section title="Stages (volgorde)">
        <StagesEditor
          stages={config.stages}
          onChange={(stages) => onChange({ ...config, stages })}
        />
      </Section>

      <Section title="Metric">
        <Field label="Wat tellen we per stage?">
          <SingleSelect
            value={config.metric ?? "candidates_count"}
            onChange={(v) =>
              onChange({ ...config, metric: v as MetricKey })
            }
            options={metrics.map((m) => ({ value: m.key, label: m.label }))}
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
