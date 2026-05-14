"use client";

/**
 * Minimal controlled/uncontrolled Collapsible primitive — built without
 * `@radix-ui/react-collapsible` to avoid pulling in a new dependency. Mirrors
 * the public surface (`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`)
 * just enough for our needs.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface CollapsibleContextValue {
  open: boolean;
  toggle: () => void;
}

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null);

function useCollapsible(): CollapsibleContextValue {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx) {
    throw new Error("Collapsible.* must be used within <Collapsible>");
  }
  return ctx;
}

interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ open: controlledOpen, defaultOpen = false, onOpenChange, children, ...props }, ref) => {
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;

    const toggle = React.useCallback(() => {
      const next = !open;
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    }, [open, isControlled, onOpenChange]);

    return (
      <CollapsibleContext.Provider value={{ open, toggle }}>
        <div ref={ref} data-state={open ? "open" : "closed"} {...props}>
          {children}
        </div>
      </CollapsibleContext.Provider>
    );
  }
);
Collapsible.displayName = "Collapsible";

interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ onClick, children, ...props }, ref) => {
    const { open, toggle } = useCollapsible();
    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) toggle();
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";

const CollapsibleContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const { open } = useCollapsible();
  if (!open) return null;
  return (
    <div
      ref={ref}
      data-state={open ? "open" : "closed"}
      className={cn("animate-in fade-in-0 slide-in-from-top-1", className)}
      {...props}
    >
      {children}
    </div>
  );
});
CollapsibleContent.displayName = "CollapsibleContent";

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
