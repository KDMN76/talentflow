"use client";

import type { FunnelBlock } from "@/lib/types/reports";
import { Section, StagesEditor } from "./shared";
import { FilterBuilder } from "../FilterBuilder";

export interface FunnelEditPanelProps {
  config: FunnelBlock;
  onChange: (next: FunnelBlock) => void;
}

/**
 * Funnel telt per pipeline-stap het aantal sollicitaties (op stage-NAAM,
 * zoals die in de pipeline heet). Geen metric-keuze — de backend telt
 * altijd unieke sollicitaties per stage.
 */
export function FunnelEditPanel({ config, onChange }: FunnelEditPanelProps) {
  return (
    <div className="space-y-4">
      <Section title="Stages (volgorde)">
        <StagesEditor
          stages={config.stages}
          onChange={(stages) => onChange({ ...config, stages })}
        />
        <p className="text-[10px] text-muted-foreground">
          Gebruik de exacte namen van je pipeline-stappen. Minimaal 2 stages.
        </p>
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
