"use client";

import type {
  DimensionDef,
  DimensionKey,
  MetricDef,
  TableBlockConfig,
} from "@/lib/types/reports";
import { Field, MultiSelectChips, Section, SingleSelect } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface TableEditPanelProps {
  config: TableBlockConfig;
  onChange: (next: TableBlockConfig) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

export function TableEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: TableEditPanelProps) {
  const dimOptions = dimensions.map((d) => ({ value: d.key, label: d.label }));

  return (
    <div className="space-y-4">
      <Section title="Rijen (group-by)">
        <MultiSelectChips
          values={config.rows}
          onChange={(rows) =>
            onChange({ ...config, rows: rows as DimensionKey[] })
          }
          options={dimOptions}
        />
      </Section>

      <Section title="Kolommen (optioneel)">
        <MultiSelectChips
          values={config.cols ?? []}
          onChange={(cols) =>
            onChange({
              ...config,
              cols: (cols.length ? cols : undefined) as DimensionKey[] | undefined,
            })
          }
          options={dimOptions}
        />
      </Section>

      <Section title="Metric">
        <Field label="Welke meetwaarde?">
          <SingleSelect
            value={config.metric}
            onChange={(v) =>
              onChange({ ...config, metric: v as TableBlockConfig["metric"] })
            }
            options={metrics.map((m) => ({ value: m.key, label: m.label }))}
          />
        </Field>
        <Field label="Sortering">
          <SingleSelect
            value={config.sort_by ?? "metric_desc"}
            onChange={(v) =>
              onChange({
                ...config,
                sort_by: v as TableBlockConfig["sort_by"],
              })
            }
            options={[
              { value: "metric_desc", label: "Metric — hoog naar laag" },
              { value: "metric_asc", label: "Metric — laag naar hoog" },
              { value: "label_asc", label: "Label — alfabetisch" },
            ]}
          />
        </Field>
      </Section>

      <Section title="Opties">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.show_totals ?? false}
            onChange={(e) =>
              onChange({ ...config, show_totals: e.target.checked })
            }
            className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600"
          />
          <span className="text-zinc-700 dark:text-zinc-300">
            Toon totaal-rij
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
