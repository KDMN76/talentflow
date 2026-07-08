"use client";

import type {
  DimensionDef,
  MetricDef,
  TableBlock,
} from "@/lib/types/reports";
import { Input } from "@/components/ui/input";
import { Field, MultiSelectChips, Section, SingleSelect } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface TableEditPanelProps {
  config: TableBlock;
  onChange: (next: TableBlock) => void;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
}

type SortChoice = "metric_desc" | "metric_asc" | "label_asc";

function toSortChoice(sort: TableBlock["sort"]): SortChoice {
  if (!sort || sort.key === "metric") {
    return sort?.direction === "asc" ? "metric_asc" : "metric_desc";
  }
  return "label_asc";
}

function fromSortChoice(choice: SortChoice): TableBlock["sort"] {
  switch (choice) {
    case "metric_asc":
      return { key: "metric", direction: "asc" };
    case "label_asc":
      return { key: "label", direction: "asc" };
    default:
      return { key: "metric", direction: "desc" };
  }
}

export function TableEditPanel({
  config,
  onChange,
  metrics,
  dimensions,
}: TableEditPanelProps) {
  const dimOptions = dimensions.map((d) => ({ value: d.key, label: d.label }));

  const keysToDims = (keys: string[]): DimensionDef[] =>
    keys
      .map((k) => dimensions.find((d) => d.key === k))
      .filter((d): d is DimensionDef => !!d);

  const setMetric = (key: string) => {
    const m = metrics.find((x) => x.key === key);
    if (m) onChange({ ...config, metric: m });
  };

  return (
    <div className="space-y-4">
      <Section title="Rijen (group-by)">
        <MultiSelectChips
          values={(config.rows ?? []).map((d) => d.key)}
          onChange={(keys) => onChange({ ...config, rows: keysToDims(keys) })}
          options={dimOptions}
        />
      </Section>

      <Section title="Kolommen (optioneel)">
        <MultiSelectChips
          values={(config.cols ?? []).map((d) => d.key)}
          onChange={(keys) =>
            onChange({
              ...config,
              cols: keys.length ? keysToDims(keys) : undefined,
            })
          }
          options={dimOptions}
        />
      </Section>

      <Section title="Metric">
        <Field label="Welke meetwaarde?">
          <SingleSelect
            value={config.metric?.key ?? ""}
            onChange={setMetric}
            options={metrics.map((m) => ({ value: m.key, label: m.label }))}
          />
        </Field>
        <Field label="Sortering">
          <SingleSelect
            value={toSortChoice(config.sort)}
            onChange={(v) =>
              onChange({ ...config, sort: fromSortChoice(v as SortChoice) })
            }
            options={[
              { value: "metric_desc", label: "Metric — hoog naar laag" },
              { value: "metric_asc", label: "Metric — laag naar hoog" },
              { value: "label_asc", label: "Label — alfabetisch" },
            ]}
          />
        </Field>
        <Field label="Maximum aantal rijen">
          <Input
            type="number"
            min={1}
            max={10000}
            value={config.limit ?? 1000}
            onChange={(e) =>
              onChange({
                ...config,
                limit: parseInt(e.target.value, 10) || 1000,
              })
            }
            className="h-9 text-sm"
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
