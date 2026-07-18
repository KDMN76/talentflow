"use client";

/**
 * Instellingen → Modules — per-tenant module-zichtbaarheid (admin).
 *
 * Toont een toggle per module-groep. Kern (dashboard, vacatures, kandidaten,
 * pipeline, inbox, instellingen) is niet uitschakelbaar en staat hier dus
 * niet tussen. Wijzigingen gaan via PUT /api/tenants/modules (admin-only,
 * audit-event server-side); de sidebar pikt de nieuwe flags direct op via
 * de gedeelde react-query cache.
 */

import { useTranslation } from "react-i18next";
import {
  Ban,
  BarChart3,
  Blocks,
  Bot,
  Briefcase,
  Globe,
  MessageSquare,
  Phone,
  Receipt,
  Send,
  Share2,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useUsers";
import {
  MODULE_KEYS,
  useTenantModules,
  useUpdateTenantModules,
  type ModuleKey,
} from "@/hooks/useTenantModules";

// Presentatie-metadata per module-key; labels/omschrijvingen komen uit i18n
// (settingsCore:modules.items.<i18nKey>).
const MODULE_META: Record<
  ModuleKey,
  { icon: LucideIcon; i18nKey: string; frozen?: boolean }
> = {
  recruit_to_cash: { icon: Receipt, i18nKey: "recruitToCash" },
  outreach: { icon: Send, i18nKey: "outreach" },
  sourcing_ai: { icon: Bot, i18nKey: "sourcingAi" },
  voice: { icon: Phone, i18nKey: "voice", frozen: true },
  whatsapp: { icon: MessageSquare, i18nKey: "whatsapp", frozen: true },
  job_boards: { icon: Briefcase, i18nKey: "jobBoards" },
  career_pages: { icon: Globe, i18nKey: "careerPages" },
  portals: { icon: Share2, i18nKey: "portals" },
  reports_analytics: { icon: BarChart3, i18nKey: "reportsAnalytics" },
  compliance_plus: { icon: Shield, i18nKey: "compliancePlus" },
};

export default function ModulesSettingsPage() {
  const { t } = useTranslation("settingsCore");
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const { data: modules, isLoading, isError } = useTenantModules();
  const updateModules = useUpdateTenantModules();

  const isAdmin =
    currentUser?.role === "admin" ||
    currentUser?.role === "super_admin" ||
    currentUser?.role === "owner";

  const handleToggle = async (key: ModuleKey, enabled: boolean) => {
    try {
      await updateModules.mutateAsync({ [key]: enabled });
      toast({
        title: enabled
          ? t("modules.toasts.enabled.title")
          : t("modules.toasts.disabled.title"),
        description: t(
          enabled
            ? "modules.toasts.enabled.description"
            : "modules.toasts.disabled.description",
          { module: t(`modules.items.${MODULE_META[key].i18nKey}.title`) }
        ),
      });
    } catch {
      toast({
        title: t("modules.toasts.error.title"),
        description: t("modules.toasts.error.description"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title={t("modules.title")}
        description={t("modules.description")}
      />

      {!isAdmin && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-4 py-3">
          <Ban className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t("modules.adminOnly")}
          </p>
        </div>
      )}

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Blocks className="h-4 w-4 text-indigo-600" />
            {t("modules.cardTitle")}
          </CardTitle>
          <CardDescription>{t("modules.cardDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError || !modules ? (
            <div className="py-8 text-center text-sm text-destructive">
              {t("modules.loadError")}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {MODULE_KEYS.map((key) => {
                const meta = MODULE_META[key];
                const Icon = meta.icon;
                const enabled = modules[key] !== false;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 px-5 py-4"
                  >
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
                      <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {t(`modules.items.${meta.i18nKey}.title`)}
                        </p>
                        {meta.frozen && (
                          <Badge
                            variant="secondary"
                            className="border-0 bg-zinc-100 px-1.5 py-0 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            {t("modules.frozenBadge")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t(`modules.items.${meta.i18nKey}.description`)}
                      </p>
                    </div>
                    <Switch
                      checked={enabled}
                      disabled={!isAdmin || updateModules.isPending}
                      onCheckedChange={(next) => handleToggle(key, next)}
                      aria-label={t(`modules.items.${meta.i18nKey}.title`)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("modules.coreNote")}</p>
    </div>
  );
}
