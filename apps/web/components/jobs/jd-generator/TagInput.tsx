"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Compact chip-style tag input. Accepts comma- or Enter-terminated values and
 * renders them as removable badges. Used for the "key skills" field in the
 * JD-generator wizard step 1.
 */
export interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  /** Maximum number of tags. Default: no limit. */
  max?: number;
  className?: string;
}

export function TagInput({
  value,
  onChange,
  placeholder = "Tik en druk Enter…",
  max,
  className,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const addTag = (raw: string) => {
    const next = raw.trim();
    if (!next) return;
    if (typeof max === "number" && value.length >= max) return;
    if (value.some((t) => t.toLowerCase() === next.toLowerCase())) return;
    onChange([...value, next]);
    setDraft("");
  };

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      removeAt(value.length - 1);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-2 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1",
        className
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-indigo-500 hover:text-indigo-800"
            aria-label={`Verwijder ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => draft.trim() && addTag(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="h-7 min-w-[120px] flex-1 border-0 px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </div>
  );
}
