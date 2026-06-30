"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Network,
  Plus,
  Search,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import {
  useSecuritySettings,
  useUpdateSecuritySettings,
  useAddIpAllowlistEntry,
  useRemoveIpAllowlistEntry,
  useVerifyIp,
  useCurrentIp,
  validateCidr,
} from "@/hooks/useSecurity";
import { cn } from "@/lib/utils";

export default function IpAllowlistPage() {
  const { t } = useTranslation("settingsSecurity");
  const { toast } = useToast();
  const { data: settings, isLoading } = useSecuritySettings();
  const { data: currentIp } = useCurrentIp();
  const updateMutation = useUpdateSecuritySettings();
  const addEntry = useAddIpAllowlistEntry();
  const removeEntry = useRemoveIpAllowlistEntry();
  const verifyIp = useVerifyIp();

  const [newCidr, setNewCidr] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<{
    ip: string;
    matches: boolean;
  } | null>(null);

  const cidrError = useMemo(() => {
    if (!newCidr) return null;
    return validateCidr(newCidr);
  }, [newCidr]);

  // Lockout-guard: huidige IP is niet in de lijst, allowlist enabled-toggle = on.
  const currentIpCovered = useMemo(() => {
    if (!currentIp || !settings) return false;
    return settings.ip_allowlist.some((e) => simpleCidrMatch(currentIp, e.cidr));
  }, [currentIp, settings]);

  const handleAdd = async () => {
    if (!newCidr) return;
    if (cidrError) {
      toast({
        title: t("ipAllowlist.toasts.invalidCidr.title"),
        description: cidrError,
        variant: "destructive",
      });
      return;
    }
    const final =
      newCidr.includes("/") ? newCidr : `${newCidr}/32`;
    await addEntry.mutateAsync({
      cidr: final,
      label: newLabel || undefined,
    });
    setNewCidr("");
    setNewLabel("");
    toast({ title: t("ipAllowlist.toasts.ipAdded.title") });
  };

  const handleAddCurrent = async () => {
    if (!currentIp) return;
    await addEntry.mutateAsync({
      cidr: `${currentIp}/32`,
      label: t("ipAllowlist.labels.myCurrentIp"),
    });
    toast({ title: t("ipAllowlist.toasts.currentIpAdded.title") });
  };

  const handleRemove = async (cidr: string) => {
    if (!confirm(t("ipAllowlist.confirm.remove", { cidr }))) return;
    await removeEntry.mutateAsync(cidr);
    toast({ title: t("ipAllowlist.toasts.removed.title") });
  };

  const handleToggle = async (next: boolean) => {
    if (next && !currentIpCovered) {
      const ok = confirm(
        t("ipAllowlist.confirm.lockout", {
          ip: currentIp ?? t("ipAllowlist.confirm.ipUnknown"),
        })
      );
      if (!ok) return;
    }
    await updateMutation.mutateAsync({ ip_allowlist_enabled: next });
    toast({
      title: next
        ? t("ipAllowlist.toasts.allowlistEnabled.title")
        : t("ipAllowlist.toasts.allowlistDisabled.title"),
    });
  };

  const handleVerify = async () => {
    if (!verifyInput) return;
    const r = await verifyIp.mutateAsync(verifyInput);
    setVerifyResult({ ip: r.ip, matches: r.matches });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/settings/security"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t("backToSecurity")}
      </Link>

      <PageHeader
        title={t("ipAllowlist.title")}
        description={t("ipAllowlist.description")}
      />

      {isLoading && (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      )}

      {/* Self-lockout guard */}
      {settings && !currentIpCovered && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 text-xs space-y-1.5">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              {t("ipAllowlist.lockoutGuard.title")}
            </p>
            <p className="text-amber-700 dark:text-amber-400">
              {t("ipAllowlist.lockoutGuard.bodyWithIp", {
                ip: currentIp ?? t("ipAllowlist.lockoutGuard.ipUnknown"),
              })}
            </p>
            {currentIp && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddCurrent}
                disabled={addEntry.isPending}
                className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-950/30"
              >
                <Zap className="mr-1.5 h-3.5 w-3.5" />
                {t("ipAllowlist.lockoutGuard.addCurrentIp", { ip: currentIp })}
              </Button>
            )}
          </div>
        </div>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center justify-between p-5">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Network className="h-4 w-4 text-indigo-600" />
              {t("ipAllowlist.toggle.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("ipAllowlist.toggle.description")}
            </p>
          </div>
          <Switch
            checked={!!settings?.ip_allowlist_enabled}
            onCheckedChange={handleToggle}
            disabled={updateMutation.isPending}
          />
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{t("ipAllowlist.ranges.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("ipAllowlist.ranges.cidrLabel")}</Label>
              <Input
                placeholder={t("ipAllowlist.ranges.cidrPlaceholder")}
                value={newCidr}
                onChange={(e) => setNewCidr(e.target.value)}
                className={cn(cidrError && "border-destructive")}
              />
              {cidrError && (
                <p className="text-[11px] text-destructive">{cidrError}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("ipAllowlist.ranges.labelLabel")}</Label>
              <Input
                placeholder={t("ipAllowlist.ranges.labelPlaceholder")}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleAdd}
                disabled={!newCidr || !!cidrError || addEntry.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 border-0 w-full sm:w-auto"
              >
                {addEntry.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {t("ipAllowlist.ranges.add")}
              </Button>
            </div>
          </div>

          {currentIp && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddCurrent}
              disabled={addEntry.isPending}
            >
              <Zap className="mr-1.5 h-3.5 w-3.5" />
              {t("ipAllowlist.ranges.addCurrentIp", { ip: currentIp })}
            </Button>
          )}

          <div className="rounded-lg border border-border divide-y">
            {settings?.ip_allowlist.length ? (
              settings.ip_allowlist.map((e) => (
                <div
                  key={e.cidr}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                        {e.cidr}
                      </code>
                      {e.label && (
                        <span className="text-sm">{e.label}</span>
                      )}
                      {currentIp && simpleCidrMatch(currentIp, e.cidr) && (
                        <Badge className="text-[10px] gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0">
                          <CheckCircle2 className="h-3 w-3" />
                          {t("ipAllowlist.ranges.coversYourIp")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {t("ipAllowlist.ranges.addedOn", {
                        date: new Date(e.added_at).toLocaleDateString("nl-NL"),
                      })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRemove(e.cidr)}
                    disabled={removeEntry.isPending}
                    className="text-destructive border-destructive/50 hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("ipAllowlist.ranges.empty")}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{t("ipAllowlist.verify.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t("ipAllowlist.verify.description")}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder={t("ipAllowlist.verify.placeholder")}
              value={verifyInput}
              onChange={(e) => setVerifyInput(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="outline"
              onClick={handleVerify}
              disabled={!verifyInput || verifyIp.isPending}
            >
              {verifyIp.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              {t("ipAllowlist.verify.button")}
            </Button>
          </div>
          {verifyResult && (
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-xs flex items-center gap-2",
                verifyResult.matches
                  ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                  : "border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 text-red-800 dark:text-red-300"
              )}
            >
              {verifyResult.matches ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {t("ipAllowlist.verify.ipPrefix")}
              <code className="font-mono">{verifyResult.ip}</code>{" "}
              {verifyResult.matches
                ? t("ipAllowlist.verify.allowed")
                : t("ipAllowlist.verify.denied")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Eenvoudige client-side CIDR match — alleen voor UI-feedback. */
function simpleCidrMatch(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = bitsRaw ? parseInt(bitsRaw, 10) : 32;
  const a = ipToNum(ip);
  const b = ipToNum(base);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}
function ipToNum(ip: string): number | null {
  const p = ip.split(".").map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
