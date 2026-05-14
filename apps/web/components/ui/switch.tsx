"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * Lightweight controlled/uncontrolled switch — geen Radix dep nodig.
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      defaultChecked,
      onCheckedChange,
      disabled,
      id,
      className,
      "aria-label": ariaLabel,
    },
    ref
  ) => {
    const [internal, setInternal] = React.useState(!!defaultChecked);
    const isControlled = checked !== undefined;
    const value = isControlled ? checked! : internal;

    const toggle = () => {
      if (disabled) return;
      const next = !value;
      if (!isControlled) setInternal(next);
      onCheckedChange?.(next);
    };

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        id={id}
        disabled={disabled}
        aria-checked={value}
        aria-label={ariaLabel}
        onClick={toggle}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          value
            ? "bg-indigo-600"
            : "bg-zinc-200 dark:bg-zinc-700",
          className
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
            value ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
