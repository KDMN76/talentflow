"use client";

import Link from "next/link";
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
  const { data: sso, isLoading: ssoLoading } = useSsoConfig();
  const { data: twofa, isLoading: tfaLoading } = useTwoFactorStatus();
  const { data: settings, isLoading: setLoading } = useSecuritySettings();

  const sections: SecuritySectionLink[] = [
    {
      href: "/settings/security/sso",
      label: "SSO / SAML",
      description:
        "Single sign-on via Okta, Azure AD, Google Workspace of een generieke SAML 2.0-IdP.",
      icon: KeyRound,
      iconClass: "bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge
            loading={ssoLoading}
            ok={!!sso?.enabled}
            okLabel={`${sso?.provider?.toUpperCase() ?? ""} actief`}
            warnLabel="Niet geconfigureerd"
          />
          {sso?.enabled && (
            <span className="text-[10px] text-muted-foreground">
              Auto-create: {sso.auto_create_users ? "aan" : "uit"}
            </span>
          )}
        </div>
      ),
    },
    {
      href: "/settings/security/2fa",
      label: "Twee-factor-authenticatie",
      description:
        "TOTP-app (Google Authenticator, Authy, 1Password) + 10 backup-codes per gebruiker.",
      icon: ShieldCheck,
      iconClass:
        "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge
            loading={tfaLoading}
            ok={!!twofa?.enabled}
            okLabel="Ingeschakeld"
            warnLabel="Niet ingeschakeld"
          />
          {settings && (
            <span className="text-[10px] text-muted-foreground">
              Beleid:{" "}
              {settings.two_factor_policy === "all"
                ? "Verplicht voor iedereen"
                : settings.two_factor_policy === "admins"
                ? "Verplicht voor admins"
                : "Niet verplicht"}
            </span>
          )}
        </div>
      ),
    },
    {
      href: "/settings/security/ip-allowlist",
      label: "IP-allowlist",
      description:
        "Beperk toegang tot vertrouwde IP-adressen of CIDR-ranges (kantoor, VPN, VPS).",
      icon: Network,
      iconClass:
        "bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge
            loading={setLoading}
            ok={!!settings?.ip_allowlist_enabled}
            okLabel={`Actief — ${settings?.ip_allowlist.length ?? 0} ranges`}
            warnLabel={
              settings?.ip_allowlist.length
                ? `${settings.ip_allowlist.length} ranges, niet actief`
                : "Geen restrictie"
            }
          />
        </div>
      ),
    },
    {
      href: "/settings/security/password-policy",
      label: "Wachtwoord-beleid",
      description:
        "Minimale lengte, complexiteit en rotatie-interval voor lokale wachtwoorden.",
      icon: Lock,
      iconClass:
        "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      rightSlot: (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 border-0">
            {settings ? `Min ${settings.password_policy.min_length} tekens` : "—"}
          </Badge>
        </div>
      ),
    },
  ];

  const headerBadges: Array<{ label: string; ok: boolean }> = [
    { label: "SSO", ok: !!sso?.enabled },
    {
      label:
        settings?.two_factor_policy === "all"
          ? "2FA verplicht (iedereen)"
          : settings?.two_factor_policy === "admins"
          ? "2FA verplicht (admins)"
          : "2FA niet-verplicht",
      ok:
        !!settings &&
        (settings.two_factor_policy === "all" ||
          settings.two_factor_policy === "admins"),
    },
    {
      label: "IP-allowlist",
      ok: !!settings?.ip_allowlist_enabled,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Security & toegang"
        description="Centrale beheersing van authenticatie, autorisatie en netwerk-restricties voor deze tenant."
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
                  Rollen & rechten
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Beheer system-rollen + maak aangepaste rollen voor compliance,
                  billing of klant-specifieke flows.
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
                  WORM Audit-trail
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Onveranderbaar audit-log van alle security-, admin- en
                  data-events. AVG art. 30-conform.
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
