"use client";

import { useMemo } from "react";
import { Check, Lock, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RBAC_RESOURCES,
  RBAC_ACTIONS,
  type PermissionGrant,
  type RbacAction,
  type RbacResource,
  type Role,
} from "@/lib/types/security";
import { effectivePermissions } from "@/hooks/useSecurity";

interface PermissionMatrixEditorProps {
  /** Direct grants on this role (zonder inheritance). */
  value: PermissionGrant[];
  onChange?: (next: PermissionGrant[]) => void;
  /** Wanneer aan: read-only weergave met inherited-state-indicator. */
  readOnly?: boolean;
  /** Parent-rol voor inheritance-visualisatie. */
  inheritsFrom?: Role | null;
  /** Volledige rol-lijst — nodig voor diepe inheritance. */
  allRoles?: Role[];
}

/**
 * Permission-matrix editor — resources × actions met checkbox grid.
 *
 * Inherited grants worden visueel onderscheiden:
 *   - direct: solid checkbox (klikbaar)
 *   - inherited: ghost checkbox met "geërfd"-indicator (niet uitvinkbaar; je
 *     kunt alleen MEER toevoegen, geen geërfde rechten verwijderen op kindrol)
 */
export function PermissionMatrixEditor({
  value,
  onChange,
  readOnly,
  inheritsFrom,
  allRoles = [],
}: PermissionMatrixEditorProps) {
  // Bereken set per resource → directe acties
  const directMap = useMemo(() => {
    const m: Partial<Record<RbacResource, Set<RbacAction>>> = {};
    for (const g of value) {
      m[g.resource] = new Set(g.actions);
    }
    return m;
  }, [value]);

  // Bereken inherited-acties (vanuit parent + parents-of-parents)
  const inheritedMap = useMemo(() => {
    if (!inheritsFrom) return {};
    const eff = effectivePermissions(inheritsFrom, allRoles);
    const m: Partial<Record<RbacResource, Set<RbacAction>>> = {};
    for (const g of eff) m[g.resource] = new Set(g.actions);
    return m;
  }, [inheritsFrom, allRoles]);

  const toggle = (resource: RbacResource, action: RbacAction) => {
    if (readOnly || !onChange) return;
    const inherited = inheritedMap[resource]?.has(action);
    if (inherited) return; // niet uitvinkbaar — geërfd
    const next = [...value];
    const idx = next.findIndex((g) => g.resource === resource);
    if (idx === -1) {
      next.push({ resource, actions: [action] });
    } else {
      const set = new Set(next[idx].actions);
      if (set.has(action)) set.delete(action);
      else set.add(action);
      if (set.size === 0) next.splice(idx, 1);
      else next[idx] = { resource, actions: Array.from(set) };
    }
    onChange(next);
  };

  const toggleRow = (resource: RbacResource, all: boolean) => {
    if (readOnly || !onChange) return;
    const next = value.filter((g) => g.resource !== resource);
    if (all) {
      const inheritedSet = inheritedMap[resource] ?? new Set<RbacAction>();
      const directActions = RBAC_ACTIONS.map((a) => a.key).filter(
        (a) => !inheritedSet.has(a)
      );
      if (directActions.length) {
        next.push({ resource, actions: directActions });
      }
    }
    onChange(next);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-zinc-50 dark:bg-zinc-900/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold w-44">Resource</th>
            {RBAC_ACTIONS.map((a) => (
              <th key={a.key} className="px-2 py-2 text-center font-semibold">
                {a.label}
              </th>
            ))}
            {!readOnly && (
              <th className="px-2 py-2 text-center font-semibold w-20">Alle</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {RBAC_RESOURCES.map((r) => {
            const direct = directMap[r.key] ?? new Set<RbacAction>();
            const inherited = inheritedMap[r.key] ?? new Set<RbacAction>();
            const allActions = RBAC_ACTIONS.map((a) => a.key);
            const allChecked = allActions.every(
              (a) => direct.has(a) || inherited.has(a)
            );
            return (
              <tr
                key={r.key}
                className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40"
              >
                <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                  {r.label}
                </td>
                {RBAC_ACTIONS.map((a) => {
                  const isDirect = direct.has(a.key);
                  const isInherited = inherited.has(a.key);
                  const checked = isDirect || isInherited;
                  return (
                    <td
                      key={a.key}
                      className="px-2 py-2 text-center"
                    >
                      <button
                        type="button"
                        disabled={readOnly || isInherited}
                        onClick={() => toggle(r.key, a.key)}
                        title={
                          isInherited
                            ? `Geërfd van ${inheritsFrom?.label ?? "parent"}`
                            : checked
                            ? "Verwijderen"
                            : "Toevoegen"
                        }
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded transition-colors",
                          checked
                            ? isInherited
                              ? "bg-indigo-50 text-indigo-400 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/30 dark:ring-indigo-800"
                              : "bg-indigo-600 text-white"
                            : "bg-zinc-100 text-zinc-300 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-600 dark:hover:bg-zinc-700",
                          (readOnly || isInherited) && "cursor-default opacity-90"
                        )}
                      >
                        {isInherited ? (
                          <Lock className="h-3 w-3" />
                        ) : checked ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Square className="h-2.5 w-2.5 opacity-50" />
                        )}
                      </button>
                    </td>
                  );
                })}
                {!readOnly && (
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => toggleRow(r.key, e.target.checked)}
                      className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                      title="Alle acties op deze resource"
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-border bg-muted/30 px-3 py-1.5 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-indigo-600" /> Direct toegekend
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-indigo-50 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/30 dark:ring-indigo-800" />
          Geërfd
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-zinc-100 dark:bg-zinc-800" /> Niet toegekend
        </span>
      </div>
    </div>
  );
}
