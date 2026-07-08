"use client";

import { useMemo, useState } from "react";
import {
  Eye,
  CheckCircle2,
  XCircle,
  HelpCircle,
  MessageSquare,
  MessagesSquare,
  Star,
  Download,
  Globe,
} from "lucide-react";
import { cn, formatRelativeDate } from "@/lib/utils";
import type {
  PortalActivityActionType,
  PortalActivityEvent,
} from "@/hooks/usePortalLinks";

const ACTION_META: Record<
  PortalActivityActionType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bg: string;
  }
> = {
  viewed_portal: {
    label: "Portaal geopend",
    icon: Globe,
    color: "text-zinc-600 dark:text-zinc-300",
    bg: "bg-zinc-100 dark:bg-zinc-800",
  },
  viewed_candidate: {
    label: "Kandidaat bekeken",
    icon: Eye,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-950/40",
  },
  approved_candidate: {
    label: "Goedgekeurd",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-950/40",
  },
  rejected_candidate: {
    label: "Afgewezen",
    icon: XCircle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-950/40",
  },
  doubted_candidate: {
    label: "Twijfel",
    icon: HelpCircle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-950/40",
  },
  commented: {
    label: "Opmerking",
    icon: MessageSquare,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-950/40",
  },
  general_comment: {
    label: "Algemene opmerking",
    icon: MessagesSquare,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-950/40",
  },
  downloaded_cv: {
    label: "CV gedownload",
    icon: Download,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-100 dark:bg-indigo-950/40",
  },
};

interface PortalActivityFeedProps {
  events: PortalActivityEvent[];
  isLoading?: boolean;
}

export function PortalActivityFeed({ events, isLoading }: PortalActivityFeedProps) {
  const [selected, setSelected] = useState<Set<PortalActivityActionType>>(
    new Set()
  );

  const counts = useMemo(() => {
    const m = new Map<PortalActivityActionType, number>();
    events.forEach((e) => m.set(e.action_type, (m.get(e.action_type) ?? 0) + 1));
    return m;
  }, [events]);

  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [events]
  );

  const filtered = selected.size === 0
    ? sorted
    : sorted.filter((e) => selected.has(e.action_type));

  const toggleChip = (k: PortalActivityActionType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800/50"
          />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="h-12 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
          <Globe className="h-5 w-5 text-zinc-400" />
        </div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nog geen activiteit
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Zodra je klant het portaal opent of feedback geeft, verschijnen de
          gebeurtenissen hier in real-time.
        </p>
      </div>
    );
  }

  // Build chip list from action types that actually appear in the data
  const chipTypes: PortalActivityActionType[] = (
    Object.keys(ACTION_META) as PortalActivityActionType[]
  ).filter((k) => counts.has(k));

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {chipTypes.map((t) => {
          const meta = ACTION_META[t];
          const active = selected.has(t);
          const Icon = meta.icon;
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleChip(t)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300"
                  : "border-zinc-200 dark:border-zinc-700 bg-background text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              )}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
              <span className="text-muted-foreground">{counts.get(t)}</span>
            </button>
          );
        })}
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
          >
            Wissen
          </button>
        )}
      </div>

      {/* Timeline */}
      <ol className="relative space-y-3 border-l border-zinc-200 dark:border-zinc-800 pl-5">
        {filtered.map((event) => {
          const meta = ACTION_META[event.action_type];
          const Icon = meta.icon;
          const comment = (event.metadata?.comment as string) ?? null;
          const rating = (event.metadata?.rating as number | undefined) ?? null;
          const reason = (event.metadata?.reason as string) ?? null;
          const slot = (event.metadata?.slot as string) ?? null;

          return (
            <li key={event.id} className="relative">
              <span
                className={cn(
                  "absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background",
                  meta.bg
                )}
              >
                <Icon className={cn("h-3 w-3", meta.color)} />
              </span>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-background px-3.5 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-zinc-900 dark:text-zinc-100">
                    <span className="font-semibold">{meta.label}</span>
                    {event.candidate_name && (
                      <>
                        {" — "}
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {event.candidate_name}
                        </span>
                      </>
                    )}
                    {!event.candidate_name && event.actor_name && (
                      <>
                        {" — "}
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {event.actor_name}
                        </span>
                      </>
                    )}
                  </p>
                  <time
                    className="text-[11px] text-muted-foreground tabular-nums"
                    dateTime={event.created_at}
                    title={new Date(event.created_at).toLocaleString("nl-NL")}
                  >
                    {formatRelativeDate(event.created_at)}
                  </time>
                </div>
                {(comment || rating !== null || reason || slot) && (
                  <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                    {rating !== null && (
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              "h-3 w-3",
                              i < rating
                                ? "text-amber-500 fill-amber-500"
                                : "text-zinc-300 dark:text-zinc-600"
                            )}
                          />
                        ))}
                      </div>
                    )}
                    {comment && (
                      <p className="italic text-zinc-600 dark:text-zinc-400">
                        “{comment}”
                      </p>
                    )}
                    {reason && <p>Reden: {reason}</p>}
                    {slot && (
                      <p>
                        Tijdslot:{" "}
                        {new Date(slot).toLocaleString("nl-NL", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-6 text-center text-xs text-muted-foreground">
          Geen activiteit voor de geselecteerde filters.
        </div>
      )}
    </div>
  );
}
