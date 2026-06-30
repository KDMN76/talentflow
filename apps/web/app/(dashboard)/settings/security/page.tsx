"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Lock,
  KeyRound,
  Network,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSsoConfig,
  useTwoFactorStatus,
  useSecuritySettings,
} from "@/hooks/useSecurity";
import { cn } from "@/lib/utils";

interface SecuritySectionLink {
  href: string;
  label: string;
  description: string;
  icon: typeof Lock;
  iconClass: string;
  rightSlot?: React.ReactNode;
}

function StatusBadge({
  ok,
  okLabel,
  warnLabel,
  loading,
}: {
  ok: boolean;
  okLabel: string;
  warnLabel: string;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-5 w-24" />;
  return (
    <Badge
      className={cn(
        "border-0 gap-1",
        ok
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      )}
    >
      {ok ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {ok ? okLabel : warnLabel}
    </Badge>
  );
}

export default function SecurityOverviewPage() {
  const { t } = useTranslation("settingsSecurity");
  const { data: sso, isLoading: ssoLoading } = useSsoConfig();
  const { data: twofa, isLoading: tfaLoading } = useTwoFactorStatus();
  const { data: settings, isLoading: setLoading } = useSecuritySettings();

  const sections: SecuritySectionLink[] = [
    {
      href: "/settings/security/sso",
      label: t("overview.sections.sso.label"),
      description: t("overview.sections.sso.description"),
      icon: KeyRound,
      iconClass: "bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge
            loading={ssoLoading}
            ok={!!sso?.enabled}
            okLabel={t("overview.sections.sso.active", {
              provider: sso?.provider?.toUpperCase() ?? "",
            })}
            warnLabel={t("overview.sections.sso.notConfigured")}
          />
          {sso?.enabled && (
            <span className="text-[10px] text-muted-foreground">
              {sso.auto_create_users
                ? t("overview.sections.sso.autoCreateOn")
                : t("overview.sections.sso.autoCreateOff")}
            </span>
          )}
        </div>
      ),
    },
    {
      href: "/settings/security/2fa",
      label: t("overview.sections.twofa.label"),
      description: t("overview.sections.twofa.description"),
      icon: ShieldCheck,
      iconClass:
        "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge
            loading={tfaLoading}
            ok={!!twofa?.enabled}
            okLabel={t("overview.sections.twofa.enabled")}
            warnLabel={t("overview.sections.twofa.disabled")}
          />
          {settings && (
            <span className="text-[10px] text-muted-foreground">
              {t("overview.sections.twofa.policyPrefix")}
              {settings.two_factor_policy === "all"
                ? t("overview.sections.twofa.policyAll")
                : settings.two_factor_policy === "admins"
                ? t("overview.sections.twofa.policyAdmins")
                : t("overview.sections.twofa.policyNone")}
            </span>
          )}
        </div>
      ),
    },
    {
      href: "/settings/security/ip-allowlist",
      label: t("overview.sections.ipAllowlist.label"),
      description: t("overview.sections.ipAllowlist.description"),
      icon: Network,
      iconClass:
        "bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge
            loading={setLoading}
            ok={!!settings?.ip_allowlist_enabled}
            okLabel={t("overview.sections.ipAllowlist.active", {
              count: settings?.ip_allowlist.length ?? 0,
            })}
            warnLabel={
              settings?.ip_allowlist.length
                ? t("overview.sections.ipAllowlist.inactiveWithRanges", {
                    count: settings.ip_allowlist.length,
                  })
                : t("overview.sections.ipAllowlist.noRestriction")
            }
          />
        </div>
      ),
    },
    {
      href: "/settings/security/password-policy",
      label: t("overview.sections.passwordPolicy.label"),
      description: t("overview.sections.passwordPolicy.description"),
      icon: Lock,
      iconClass:
        "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 border-0">
            {settings
              ? t("overview.sections.passwordPolicy.minLength", {
                  count: settings.password_policy.min_length,
                })
              : t("overview.sections.passwordPolicy.empty")}
          </Badge>
        </div>
      ),
    },
  ];

  const headerBadges: Array<{ label: string; ok: boolean }> = [
    { label: t("overview.headerBadges.sso"), ok: !!sso?.enabled },
    {
      label:
        settings?.two_factor_policy === "all"
          ? t("overview.headerBadges.twofaAll")
          : settings?.two_factor_policy === "admins"
          ? t("overview.headerBadges.twofaAdmins")
          : t("overview.headerBadges.twofaNone"),
      ok:
        !!settings &&
        (settings.two_factor_policy === "all" ||
          settings.two_factor_policy === "admins"),
    },
    {
      label: t("overview.headerBadges.ipAllowlist"),
      ok: !!settings?.ip_allowlist_enabled,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("overview.title")}
        description={t("overview.description")}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {headerBadges.map((b) => (
              <Badge
                key={b.label}
                className={cn(
                  "gap-1 border-0",
                  b.ok
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                )}
              >
                {b.ok ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <ShieldAlert className="h-3 w-3" />
                )}
                {b.label}
              </Badge>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href} className="group">
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-full">
                <CardContent className="flex items-start gap-4 p-5">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                      s.iconClass
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {s.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.description}
                    </p>
                    <div className="mt-3">{s.rightSlot}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-indigo-500 transition-colors mt-1" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Link href="/settings/roles" className="group">
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-full">
            <CardContent className="flex items-start gap-4 p-5">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("overview.roles.label")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("overview.roles.description")}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-indigo-500 transition-colors mt-1" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/compliance/audit-events" className="group">
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-full">
            <CardContent className="flex items-start gap-4 p-5">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400 shrink-0">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("overview.audit.label")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("overview.audit.description")}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-indigo-500 transition-colors mt-1" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
