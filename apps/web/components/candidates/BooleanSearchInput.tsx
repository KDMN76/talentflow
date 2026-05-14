"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Check, X, BookmarkPlus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useCreateSavedSearch } from "@/hooks/useSavedSearches";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

/**
 * Boolean search input with autocomplete-suggestions for operators (AND/OR/NOT)
 * and field-prefixes (skills:, title:). Validates parenthesis balance and
 * triggers the parent's onSearch on Enter.
 *
 * UI choices:
 * - Monospace font in the input so operator-heavy queries read like code.
 * - Suggestion popover under the input shows up to 6 best matches for the
 *   current word; arrow-key navigation selects + Enter accepts.
 * - Live validation indicator: green check (valid) / red X (invalid). Tooltip-
 *   text on the indicator explains the imbalance.
 */

const OPERATORS = ["AND", "OR", "NOT"];
const FIELDS = [
  "skills:",
  "title:",
  "company:",
  "city:",
  "country:",
  "tag:",
  "source:",
  "yoe:",
];

interface BooleanSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  /** Saved-search entity-type for the "Opslaan" dialog. */
  entityType?: "candidates" | "jobs" | "applications";
  placeholder?: string;
}

interface ValidationState {
  valid: boolean;
  message: string;
}

/**
 * Walk the query and check parenthesis + double-quote balance. Returns a
 * human-readable Dutch message when invalid.
 */
function validateQuery(q: string): ValidationState {
  let depth = 0;
  let inQuote = false;
  for (const ch of q) {
    if (ch === '"' && depth >= 0) inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return { valid: false, message: "Te veel sluithaakjes" };
    }
  }
  if (depth > 0) return { valid: false, message: `${depth} ongesloten haakje${depth === 1 ? "" : "s"}` };
  if (inQuote) return { valid: false, message: "Niet-gesloten aanhalingsteken" };
  return { valid: true, message: "Geldige query" };
}

/**
 * Compute the current word at the caret-position so we can show contextual
 * suggestions (operators after a space, field-prefixes when starting fresh).
 */
function getCurrentWord(value: string, caret: number): { word: string; start: number } {
  let start = caret;
  while (start > 0 && /\S/.test(value[start - 1])) start--;
  return { word: value.slice(start, caret), start };
}

function getSuggestions(currentWord: string, before: string): string[] {
  const lower = currentWord.toLowerCase();
  const upper = currentWord.toUpperCase();

  // After a space and the previous token is a "term" (not an operator),
  // operators are the most likely next token.
  const trimmedBefore = before.trimEnd();
  const lastToken = trimmedBefore.split(/\s+/).pop() ?? "";
  const lastIsTerm = lastToken.length > 0 && !OPERATORS.includes(lastToken.toUpperCase());

  const opMatches = OPERATORS.filter((op) =>
    upper.length === 0 ? lastIsTerm : op.startsWith(upper)
  );
  const fieldMatches = FIELDS.filter((f) => f.startsWith(lower));
  return [...opMatches, ...fieldMatches].slice(0, 6);
}

export function BooleanSearchInput({
  value,
  onChange,
  onSearch,
  entityType = "candidates",
  placeholder = "Bijv. react AND typescript NOT junior",
}: BooleanSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const { toast } = useToast();
  const createSaved = useCreateSavedSearch();

  const validation = validateQuery(value);

  const before = value.slice(0, caret);
  const { word, start } = getCurrentWord(value, caret);
  const suggestions = getSuggestions(word, value.slice(0, start));

  useEffect(() => {
    setActiveIdx(0);
  }, [word]);

  const acceptSuggestion = useCallback(
    (suggestion: string) => {
      const after = value.slice(caret);
      const head = value.slice(0, start);
      const isFieldPrefix = suggestion.endsWith(":");
      const insert = isFieldPrefix ? suggestion : suggestion + " ";
      const newValue = head + insert + after;
      const newCaret = head.length + insert.length;
      onChange(newValue);
      setShowSuggestions(false);
      // Restore caret next tick.
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newCaret, newCaret);
          setCaret(newCaret);
        }
      }, 0);
    },
    [value, caret, start, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((idx) => (idx + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((idx) => (idx - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && suggestions[activeIdx])) {
        // Tab always accepts. Enter accepts only when the active suggestion
        // would change the line — never block a clean submit.
        if (e.key === "Tab" || word.length > 0) {
          e.preventDefault();
          acceptSuggestion(suggestions[activeIdx]);
          return;
        }
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (validation.valid) onSearch(value);
    }
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    try {
      await createSaved.mutateAsync({
        entity_type: entityType,
        name: saveName.trim(),
        query: value,
      });
      toast({
        title: "Zoekopdracht opgeslagen",
        description: `"${saveName.trim()}" is toegevoegd aan je opgeslagen zoekopdrachten.`,
      });
      setSaveOpen(false);
      setSaveName("");
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Kon zoekopdracht niet opslaan.",
      });
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              onChange(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setShowSuggestions(true);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(e) => {
              const target = e.currentTarget;
              setCaret(target.selectionStart ?? target.value.length);
            }}
            onClick={(e) => {
              const target = e.currentTarget;
              setCaret(target.selectionStart ?? target.value.length);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            className="pl-9 pr-10 font-mono text-[13px]"
          />
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2"
            title={validation.message}
          >
            {value.length === 0 ? null : validation.valid ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <X className="h-4 w-4 text-rose-500" />
            )}
          </span>

          {/* Suggestions popover */}
          {showSuggestions && suggestions.length > 0 && value.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-border bg-popover shadow-md p-1"
              onMouseDown={(e) => e.preventDefault()}
            >
              {suggestions.map((s, idx) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => acceptSuggestion(s)}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 text-sm rounded-md font-mono",
                    idx === activeIdx
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                      : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  )}
                >
                  <span>{s}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {OPERATORS.includes(s) ? "operator" : "veld"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => setSaveOpen(true)}
          disabled={!value.trim() || !validation.valid}
          title="Sla deze zoekopdracht op"
        >
          <BookmarkPlus className="mr-2 h-4 w-4" />
          Opslaan
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground pl-1">
        Probeer: <code className="font-mono text-zinc-700 dark:text-zinc-300">react AND typescript NOT junior</code>
        {" — "}operators (AND/OR/NOT), aanhalingstekens en haakjes worden ondersteund.
      </p>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Zoekopdracht opslaan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="ss-name">Naam</Label>
              <Input
                id="ss-name"
                placeholder="Bijv. Senior FE — direct beschikbaar"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="space-y-2">
              <Label>Query</Label>
              <p className="font-mono text-xs px-3 py-2 rounded-md border border-border bg-zinc-50 dark:bg-zinc-800/50 break-all">
                {value || "(leeg)"}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Annuleren</Button>
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={!saveName.trim() || createSaved.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              {createSaved.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Opslaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
