"use client";

import {
  Eye,
  FileText,
  Sparkles,
  Mail,
  CheckCircle2,
  MessageSquare,
  Download,
  History,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AdminPortalLinkPermissions } from "@/lib/mockData";

export const PERMISSION_DEFS: Array<{
  key: keyof AdminPortalLinkPermissions;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "Bekijken" | "Acties" | "Gevoelig";
}> = [
  {
    key: "view_candidates",
    label: "Kandidaten bekijken",
    description:
      "Klant ziet de kandidatenlijst. Zonder dit recht is het portaal effectief leeg.",
    icon: Eye,
    group: "Bekijken",
  },
  {
    key: "view_resumes",
    label: "CV's inzien",
    description:
      "Klant kan CV-inhoud bekijken in de portal. Werkt onafhankelijk van het downloaden.",
    icon: FileText,
    group: "Bekijken",
  },
  {
    key: "view_ai_scores",
    label: "AI-matchscore tonen",
    description:
      "Toont de AI-gegenereerde score (0-100) per kandidaat. Uit voor klanten die liever zelf oordelen.",
    icon: Sparkles,
    group: "Bekijken",
  },
  {
    key: "view_pipeline_history",
    label: "Pipeline-historie tonen",
    description:
      "Klant ziet door welke fases een kandidaat is gegaan en wanneer.",
    icon: History,
    group: "Bekijken",
  },
  {
    key: "view_contact_info",
    label: "Contactgegevens tonen",
    description:
      "Onthult e-mail en telefoon. Aan voor warme klanten, uit voor leadgen.",
    icon: Mail,
    group: "Gevoelig",
  },
  {
    key: "accept_reject",
    label: "Goedkeuren / afwijzen",
    description:
      "Klant kan kandidaten doorzetten of afwijzen. Acties worden gelogd in de pipeline.",
    icon: CheckCircle2,
    group: "Acties",
  },
  {
    key: "comment",
    label: "Opmerkingen plaatsen",
    description:
      "Klant kan tekst-feedback achterlaten per kandidaat. Recruiters zien dit als comment-thread.",
    icon: MessageSquare,
    group: "Acties",
  },
  {
    key: "download_cv",
    label: "CV downloaden",
    description:
      "Klant mag een PDF-export van het CV downloaden. Standaard uit voor compliance-bewuste tenants.",
    icon: Download,
    group: "Acties",
  },
];

const GROUPS: Array<AdminPortalLinkPermissions extends never ? never : "Bekijken" | "Acties" | "Gevoelig"> = [
  "Bekijken",
  "Acties",
  "Gevoelig",
];

interface PermissionsMatrixProps {
  value: AdminPortalLinkPermissions;
  onChange: (next: AdminPortalLinkPermissions) => void;
  disabled?: boolean;
  /** Compact-mode: minder padding, kleinere typografie. */
  compact?: boolean;
}

export function PermissionsMatrix({
  value,
  onChange,
  disabled,
  compact,
}: PermissionsMatrixProps) {
  const toggle = (key: keyof AdminPortalLinkPermissions) => {
    if (disabled) return;
    onChange({ ...value, [key]: !value[key] });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        {GROUPS.map((group) => {
          const items = PERMISSION_DEFS.filter((p) => p.group === group);
          return (
            <div key={group} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group}
              </p>
              <div className="grid gap-1.5">
                {items.map((perm) => {
                  const Icon = perm.icon;
                  const checked = value[perm.key];
                  return (
                    <label
                      key={perm.key}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border bg-background transition-colors",
                        compact ? "px-3 py-2" : "px-3.5 py-2.5",
                        disabled
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                        checked
                          ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20"
                          : "border-zinc-200 dark:border-zinc-700"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded accent-indigo-600"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(perm.key)}
                      />
                      <Icon
                        className={cn(
                          "h-4 w-4 mt-0.5 shrink-0 transition-colors",
                          checked
                            ? "text-indigo-600 dark:text-indigo-400"
                            : "text-zinc-400"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "font-medium text-zinc-900 dark:text-zinc-100",
                              compact ? "text-xs" : "text-sm"
                            )}
                          >
                            {perm.label}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 text-zinc-400 hover:text-zinc-600" />
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-xs text-xs leading-relaxed"
                            >
                              {perm.description}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {!compact && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            {perm.description}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

/** Compact rendering for table rows. */
export function PermissionsBadgeRow({
  permissions,
  max = 3,
}: {
  permissions: AdminPortalLinkPermissions;
  max?: number;
}) {
  const enabled = PERMISSION_DEFS.filter((p) => permissions[p.key]);
  const head = enabled.slice(0, max);
  const rest = enabled.length - head.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {head.map((p) => (
        <span
          key={p.key}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300"
        >
          <p.icon className="h-2.5 w-2.5" />
          {p.label}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-[10px] text-muted-foreground font-medium">
          +{rest}
        </span>
      )}
      {enabled.length === 0 && (
        <span className="text-[10px] text-muted-foreground italic">
          Geen rechten
        </span>
      )}
    </div>
  );
}
