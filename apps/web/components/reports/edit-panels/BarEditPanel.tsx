"use client";

import type {
  ChartBlock,
  DimensionDef,
  MetricDef,
} from "@/lib/types/reports";
import { Field, MultiSelectChips, Section, SingleSelect } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface BarEditPanelProps {
  config: ChartBlock;
  onChange: (next: ChartBlock) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function BarEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: BarEditPanelProps) {
  const setX = (key: string) => {
    const d = dimensions.find((x) => x.key === key);
    if (d) onChange({ ...config, x: d });
  };

  const setSeries = (keys: string[]) => {
    const list = keys
      .map((k) => metrics.find((m) => m.key === k))
      .filter((m): m is MetricDef => !!m);
    // Minimaal 1 serie — backend weigert een leeg series-array.
    if (list.length > 0) onChange({ ...config, series: list });
  };

  const setGroupBy = (v: string) => {
    if (v === "__none") {
      const { group_by: _omit, ...rest } = config;
      onChange(rest as ChartBlock);
    } else {
      const d = dimensions.find((x) => x.key === v);
      if (d) onChange({ ...config, group_by: d });
    }
  };

  return (
    <div className="space-y-4">
      <Section title="X-as">
        <Field label="Dimensie">
          <SingleSelect
            value={config.x?.key ?? ""}
            onChange={setX}
            options={dimensions.map((d) => ({ value: d.key, label: d.label }))}
          />
        </Field>
      </Section>

      <Section title="Series (metrics)">
        <MultiSelectChips
          values={(config.series ?? []).map((m) => m.key)}
          onChange={setSeries}
          options={metrics.map((m) => ({ value: m.key, label: m.label }))}
        />
        <p className="text-[10px] text-muted-foreground">
          Minimaal 1 serie vereist.
        </p>
      </Section>

      <Section title="Group-by (optioneel)">
        <SingleSelect
          value={config.group_by?.key ?? "__none"}
          onChange={setGroupBy}
          options={[
            { value: "__none", label: "Geen" },
            ...dimensions.map((d) => ({ value: d.key, label: d.label })),
          ]}
        />
        {config.group_by && (
          <p className="text-[10px] text-muted-foreground">
            Bij group-by wordt alleen de eerste serie gebruikt; elke groep
            wordt een eigen reeks.
          </p>
        )}
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
