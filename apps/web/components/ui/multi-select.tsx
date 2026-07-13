"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Trigger text when nothing is selected. Default: "Alles". */
  placeholder?: string;
  className?: string;
  /**
   * Trigger label when ≥1 value is selected. Default: `${count} geselecteerd`.
   * Accepts an i18n interpolator so the parent stays the source of copy.
   */
  countLabel?: (count: number) => string;
  /** Label for the clear action. Default: "Wissen". */
  clearLabel?: string;
  /** Accessible label for the trigger. */
  "aria-label"?: string;
}

/**
 * Reusable multi-select built on the existing shadcn `dropdown-menu`
 * (`DropdownMenuCheckboxItem`). No extra dependency: Radix already ships with
 * the project. Keyboard + pointer interaction (arrow keys, Enter/Space to
 * toggle, Escape to close, focus management) is handled by Radix; toggling a
 * value keeps the menu open so multiple values can be picked in one go.
 *
 * Copy is passed in via props (`placeholder`, `countLabel`, `clearLabel`) so
 * the component itself carries no namespace coupling; callers supply i18n
 * strings. Sensible NL defaults keep it usable stand-alone.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Alles",
  className,
  countLabel = (count) => `${count} geselecteerd`,
  clearLabel = "Wissen",
  "aria-label": ariaLabel,
}: MultiSelectProps) {
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const hasSelection = selected.length > 0;

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn(
            "h-10 justify-between gap-2 font-normal",
            !hasSelection && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {hasSelection ? countLabel(selected.length) : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[12rem] overflow-y-auto"
      >
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selectedSet.has(opt.value)}
            // Keep the menu open while toggling multiple values.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(opt.value)}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
        {hasSelection && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onChange([]);
              }}
              className="gap-2 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
              {clearLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
