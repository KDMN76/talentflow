"use client";

import type {
  DimensionDef,
  DimensionKey,
  MetricDef,
  PieBlockConfig,
} from "@/lib/types/reports";
import { Field, Section, SingleSelect } from "./shared";
import { Input } from "@/components/ui/input";
import { FilterBuilder } from "../FilterBuilder";

export interface PieEditPanelProps {
  config: PieBlockConfig;
  onChange: (next: PieBlockConfig) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function PieEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: PieEditPanelProps) {
  return (
    <div className="space-y-4">
      <Section title="Metric">
        <Field label="Welk getal verdelen we?">
          <SingleSelect
            value={config.metric}
            onChange={(v) =>
              onChange({ ...config, metric: v as PieBlockConfig["metric"] })
            }
            options={metrics.map((m) => ({ value: m.key, label: m.label }))}
          />
        </Field>
      </Section>

      <Section title="Verdeel per">
        <Field label="Dimensie">
          <SingleSelect
            value={config.group_by}
            onChange={(v) =>
              onChange({ ...config, group_by: v as DimensionKey })
            }
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
          dimensions={dimensions}
        />
      </Section>
    </div>
  );
}
