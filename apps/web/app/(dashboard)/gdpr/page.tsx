"use client";

import { useMemo } from "react";
import {
  AlertCircle,
  FileSearch,
  HelpCircle,
  Inbox,
  Scale,
  Settings2,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConsentOverview } from "@/components/compliance/ConsentOverview";
import { DsarManagement } from "@/components/compliance/DsarManagement";
import { RetentionPolicies } from "@/components/compliance/RetentionPolicies";
import { AuditTrailViewer } from "@/components/compliance/AuditTrailViewer";
import { PayEquityDashboard } from "@/components/compliance/PayEquityDashboard";
import { DEIFunnelViewer } from "@/components/compliance/DEIFunnelViewer";
import { useCandidates, useCandidateCount } from "@/hooks/useCandidates";
import {
  useDsarRequests,
  useRetentionPolicies,
} from "@/hooks/useCompliance";
import { cn } from "@/lib/utils";

// ─── Stats card ──────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  iconClass?: string;
  loading?: boolean;
  tooltip?: string;
}

function StatCard({
  icon,
  label,
  value,
  hint,
  iconClass,
  loading,
  tooltip,
}: StatCardProps) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            iconClass ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          )}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            {tooltip && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-100">
            {loading ? <Skeleton className="h-6 w-12" /> : value}
          </div>
          {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Consent gauge ───────────────────────────────────────────────────────────

function ConsentGauge({
  percentage,
  loading,
}: {
  percentage: number;
  loading: boolean;
}) {
  // Conic gradient gauge — emerald for granted slice
  const pct = Math.max(0, Math.min(100, percentage));
  const colorClass =
    pct >= 80
      ? "text-emerald-600"
      : pct >= 50
      ? "text-amber-600"
      : "text-red-600";
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="relative h-16 w-16 shrink-0">
          <div
            className="h-full w-full rounded-full"
            style={{
              background: `conic-gradient(rgb(16 185 129) ${pct}%, rgb(228 228 231) ${pct}%)`,
            }}
          />
          <div className="absolute inset-1.5 rounded-full bg-card flex items-center justify-center">
            {loading ? (
              <Skeleton className="h-5 w-8" />
            ) : (
              <span className={cn("text-sm font-bold", colorClass)}>
                {pct}%
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">Consent-dekking</p>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {pct >= 80
              ? "Uitstekend"
              : pct >= 50
              ? "Voldoende"
              : "Aandacht vereist"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            % kandidaten met geldige GDPR-toestemming
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function GdprPage() {
  const { data: candidates, isLoading: candidatesLoading } = useCandidates();
  const { data: totalCandidates } = useCandidateCount();
  const { data: dsars, isLoading: dsarsLoading } = useDsarRequests();
  const { data: policies, isLoading: policiesLoading } = useRetentionPolicies();

  const stats = useMemo(() => {
    // `loaded` = kandidaten in de geladen (gepagineerde) steekproef;
    // `total` = werkelijk aantal kandidaten in de tenant (server-side count).
    // De consent-tellingen zijn een steekproef: de lijst-API geeft geen
    // server-side consent-aggregatie. Zie ROADMAP (backend consent-stats).
    const loaded = candidates?.length ?? 0;
    let granted = 0;
    let anonymized = 0;
    (candidates ?? []).forEach((c) => {
      if (c?.gdpr_consent) granted += 1;
      if (c?.name?.toLowerCase().includes("geanonimiseerd")) anonymized += 1;
    });
    const pct = loaded === 0 ? 0 : Math.round((granted / loaded) * 100);
    const pendingDsars =
      (dsars ?? []).filter(
        (d) => d?.status === "pending" || d?.status === "in_progress"
      ).length;
    const activePolicies = (policies ?? []).filter((p) => p?.enabled).length;
    return {
      loaded,
      total: totalCandidates ?? loaded,
      granted,
      pct,
      pendingDsars,
      activePolicies,
      hasActivePolicy: activePolicies > 0,
      anonymized,
    };
  }, [candidates, dsars, policies, totalCandidates]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="AVG / GDPR"
        description="Compliance-dashboard voor toestemming, DSAR-verzoeken, bewaarbeleid en audit-trail."
      />

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Kandidaten met consent"
          value={stats.granted}
          hint={`van ${stats.loaded} geladen · ${stats.total.toLocaleString(
            "nl-NL"
          )} totaal`}
          iconClass="bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400"
          loading={candidatesLoading}
          tooltip="Aantal kandidaten waarvoor een geldige, niet-verlopen GDPR-toestemming geregistreerd is."
        />
        <ConsentGauge percentage={stats.pct} loading={candidatesLoading} />
        <StatCard
          icon={<Inbox className="h-5 w-5" />}
          label="Pending DSAR-verzoeken"
          value={stats.pendingDsars}
          hint={
            stats.pendingDsars > 0
              ? "Reageer binnen 30 dagen"
              : "Geen openstaande verzoeken"
          }
          iconClass={
            stats.pendingDsars > 0
              ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
              : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
          }
          loading={dsarsLoading}
          tooltip="DSAR (Data Subject Access Request) = recht op inzage, export, correctie of verwijdering. AVG art. 12 schrijft 30 dagen voor."
        />
        <StatCard
          icon={
            stats.hasActivePolicy ? (
              <ShieldCheck className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )
          }
          label="Bewaarbeleid actief"
          value={
            stats.hasActivePolicy ? (
              <span className="text-emerald-600">Ja</span>
            ) : (
              <span className="text-red-600">Nee</span>
            )
          }
          hint={
            stats.hasActivePolicy
              ? `${stats.activePolicies} actieve regels`
              : "Configureer beleid"
          }
          iconClass={
            stats.hasActivePolicy
              ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
              : "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400"
          }
          loading={policiesLoading}
          tooltip="Wat doet retention? Bewaarbeleid bepaalt na hoeveel tijd persoonsgegevens automatisch worden gearchiveerd, geanonimiseerd of verwijderd. AVG art. 5(1)(e) — opslagbeperking."
        />
        <StatCard
          icon={<UserX className="h-5 w-5" />}
          label="Anonieme records"
          value={stats.anonymized}
          hint="Bewaard voor statistiek"
          iconClass="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          loading={candidatesLoading}
          tooltip="Records waarvan de persoonsgegevens onomkeerbaar zijn verwijderd, maar geaggregeerde data behouden blijft."
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="consent" className="space-y-4">
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-1">
          <TabsTrigger value="consent" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Consent overview
          </TabsTrigger>
          <TabsTrigger value="dsar" className="gap-1.5">
            <Inbox className="h-3.5 w-3.5" />
            DSAR-verzoeken
            {stats.pendingDsars > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {stats.pendingDsars}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="retention" className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Bewaarbeleid
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <FileSearch className="h-3.5 w-3.5" />
            Audit-trail
          </TabsTrigger>
          <TabsTrigger value="pay-equity" className="gap-1.5">
            <Scale className="h-3.5 w-3.5" />
            Pay equity
          </TabsTrigger>
          <TabsTrigger value="dei-funnel" className="gap-1.5">
            <UserCheck className="h-3.5 w-3.5" />
            DEI funnel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consent" className="mt-4">
          <ConsentOverview />
        </TabsContent>
        <TabsContent value="dsar" className="mt-4">
          <DsarManagement />
        </TabsContent>
        <TabsContent value="retention" className="mt-4">
          <RetentionPolicies />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTrailViewer />
        </TabsContent>
        <TabsContent value="pay-equity" className="mt-4">
          <PayEquityDashboard />
        </TabsContent>
        <TabsContent value="dei-funnel" className="mt-4">
          <DEIFunnelViewer />
        </TabsContent>
      </Tabs>
    </div>
  );
}
