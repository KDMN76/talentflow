"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCustomFields } from "@/hooks/useCustomFields";
import { cn } from "@/lib/utils";
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldValue,
} from "@/lib/types/atsExtensions";

/**
 * Renders custom-field controls for a given entity-type. Backed by the
 * tenant's `useCustomFields(entity_type)` definitions — when none exist,
 * the component renders nothing (no empty section noise).
 *
 * Designed as a controlled component: the parent owns the `values` map and
 * the renderer calls `onChange(key, value)` for each edit.
 */
interface CustomFieldsRendererProps {
  entityType: CustomFieldEntityType;
  values: Record<string, CustomFieldValue>;
  onChange: (key: string, value: CustomFieldValue) => void;
  /** Override the title shown above the fields. */
  title?: string;
  /** When false, hides the title block. Default: true. */
  showTitle?: boolean;
}

export function CustomFieldsRenderer({
  entityType,
  values,
  onChange,
  title = "Custom velden",
  showTitle = true,
}: CustomFieldsRendererProps) {
  const { data: definitions, isLoading } = useCustomFields(entityType);

  if (isLoading) return null;
  const defs = definitions ?? [];
  if (defs.length === 0) return null;

  return (
    <div className="space-y-4">
      {showTitle && (
        <div className="flex items-center gap-2 pt-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
          <div className="flex-1 border-t border-border" />
        </div>
      )}
      <div className="space-y-4">
        {defs.map((def) => (
          <CustomFieldInput
            key={def.id}
            def={def}
            value={values[def.key]}
            onChange={(v) => onChange(def.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

function CustomFieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefinition;
  value: CustomFieldValue;
  onChange: (v: CustomFieldValue) => void;
}) {
  const id = `cf-${def.id}`;
  const labelEl = (
    <Label htmlFor={id} className="flex items-center gap-1">
      {def.label}
      {def.required && <span className="text-rose-500">*</span>}
    </Label>
  );

  switch (def.field_type) {
    case "text":
      return (
        <div className="space-y-2">
          {labelEl}
          <Input
            id={id}
            value={(value as string | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "number":
      return (
        <div className="space-y-2">
          {labelEl}
          <Input
            id={id}
            type="number"
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </div>
      );
    case "date":
      return (
        <div className="space-y-2">
          {labelEl}
          <Input
            id={id}
            type="date"
            value={(value as string | undefined) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "dropdown": {
      const opts = def.options ?? [];
      const sel = (value as string | undefined) ?? "";
      return (
        <div className="space-y-2">
          {labelEl}
          <Select value={sel} onValueChange={(v) => onChange(v)}>
            <SelectTrigger id={id}>
              <SelectValue placeholder="Selecteer..." />
            </SelectTrigger>
            <SelectContent>
              {opts.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case "multiselect": {
      const opts = def.options ?? [];
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (opt: string) => {
        const next = arr.includes(opt) ? arr.filter((v) => v !== opt) : [...arr, opt];
        onChange(next);
      };
      return (
        <div className="space-y-2">
          {labelEl}
          <div className="grid grid-cols-2 gap-1.5">
            {opts.map((opt) => {
              const checked = arr.includes(opt);
              return (
                <label
                  key={opt}
                  className={cn(
                    "flex items-center gap-2 cursor-pointer rounded-md px-3 py-1.5 border text-sm transition-colors",
                    checked
                      ? "border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-200"
                      : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded accent-indigo-600"
                    checked={checked}
                    onChange={() => toggle(opt)}
                  />
                  {opt}
                </label>
              );
            })}
          </div>
        </div>
      );
    }
    case "boolean": {
      const checked = value === true;
      return (
        <label
          htmlFor={id}
          className="flex items-center justify-between cursor-pointer rounded-md border border-border px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <span className="text-sm font-medium">
            {def.label}
            {def.required && <span className="text-rose-500 ml-1">*</span>}
          </span>
          {/* Native checkbox styled as a switch — avoids needing a Radix Switch component. */}
          <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              checked ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"
            )}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                checked ? "translate-x-5" : "translate-x-1"
              )}
            />
          </button>
        </label>
      );
    }
    default:
      return null;
  }
}
