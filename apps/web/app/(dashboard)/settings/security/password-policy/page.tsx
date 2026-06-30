"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, Save, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useSecuritySettings,
  useUpdateSecuritySettings,
  useRoles,
} from "@/hooks/useSecurity";
import type { PasswordPolicy } from "@/lib/types/security";

export default function PasswordPolicyPage() {
  const { t } = useTranslation("settingsSecurity");
  const { toast } = useToast();
  const { data: settings, isLoading } = useSecuritySettings();
  const { data: roles } = useRoles();
  const updateMutation = useUpdateSecuritySettings();

  const [policy, setPolicy] = useState<PasswordPolicy>({
    min_length: 12,
    require_uppercase: true,
    require_lowercase: true,
    require_number: true,
    require_symbol: false,
    rotation_days: null,
  });
  const [twoFaPolicy, setTwoFaPolicy] = useState<"all" | "admins" | "none">(
    "admins"
  );
  const [twoFaRoles, setTwoFaRoles] = useState<string[]>([]);
  const [grace, setGrace] = useState(14);
  const [sessionTimeout, setSessionTimeout] = useState(60);

  useEffect(() => {
    if (settings) {
      setPolicy(settings.password_policy);
      setTwoFaPolicy(settings.two_factor_policy);
      setTwoFaRoles(settings.two_factor_required_role_ids);
      setGrace(settings.two_factor_grace_period_days);
      setSessionTimeout(settings.session_idle_timeout_minutes);
    }
  }, [settings]);

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      password_policy: policy,
      two_factor_policy: twoFaPolicy,
      two_factor_required_role_ids: twoFaRoles,
      two_factor_grace_period_days: grace,
      session_idle_timeout_minutes: sessionTimeout,
    });
    toast({ title: t("passwordPolicy.toasts.saved.title") });
  };

  const toggleRequiredRole = (id: string) => {
    setTwoFaRoles((cur) =>
      cur.includes(id) ? cur.filter((r) => r !== id) : [...cur, id]
    );
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
        title={t("passwordPolicy.title")}
        description={t("passwordPolicy.description")}
      />

      {isLoading && (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      )}

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-indigo-600" />
            {t("passwordPolicy.requirements.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("passwordPolicy.requirements.minLengthLabel")}</Label>
            <Input
              type="number"
              min={6}
              max={64}
              value={policy.min_length}
              onChange={(e) =>
                setPolicy((p) => ({
                  ...p,
                  min_length: parseInt(e.target.value, 10) || 6,
                }))
              }
              className="max-w-[120px]"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("passwordPolicy.requirements.minLengthHint")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                {
                  key: "require_uppercase",
                  label: t("passwordPolicy.requirements.requireUppercase"),
                },
                {
                  key: "require_lowercase",
                  label: t("passwordPolicy.requirements.requireLowercase"),
                },
                {
                  key: "require_number",
                  label: t("passwordPolicy.requirements.requireNumber"),
                },
                {
                  key: "require_symbol",
                  label: t("passwordPolicy.requirements.requireSymbol"),
                },
              ] as const
            ).map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
              >
                <span className="text-sm">{row.label}</span>
                <Switch
                  checked={policy[row.key]}
                  onCheckedChange={(v) =>
                    setPolicy((p) => ({ ...p, [row.key]: v }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>{t("passwordPolicy.requirements.rotationLabel")}</Label>
            <Select
              value={policy.rotation_days?.toString() ?? "0"}
              onValueChange={(v) =>
                setPolicy((p) => ({
                  ...p,
                  rotation_days: v === "0" ? null : parseInt(v, 10),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">
                  {t("passwordPolicy.requirements.rotationNone")}
                </SelectItem>
                <SelectItem value="60">
                  {t("passwordPolicy.requirements.rotation60")}
                </SelectItem>
                <SelectItem value="90">
                  {t("passwordPolicy.requirements.rotation90")}
                </SelectItem>
                <SelectItem value="180">
                  {t("passwordPolicy.requirements.rotation180")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {t("passwordPolicy.requirements.rotationHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{t("passwordPolicy.twofa.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("passwordPolicy.twofa.requiredForLabel")}</Label>
            <Select
              value={twoFaPolicy}
              onValueChange={(v) =>
                setTwoFaPolicy(v as "all" | "admins" | "none")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t("passwordPolicy.twofa.none")}
                </SelectItem>
                <SelectItem value="admins">
                  {t("passwordPolicy.twofa.admins")}
                </SelectItem>
                <SelectItem value="all">
                  {t("passwordPolicy.twofa.all")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(roles?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Label>{t("passwordPolicy.twofa.extraRolesLabel")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {roles!.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRequiredRole(r.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors ${
                      twoFaRoles.includes(r.id)
                        ? "bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800"
                        : "bg-background border-border text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("passwordPolicy.twofa.graceLabel")}</Label>
            <Input
              type="number"
              min={0}
              max={90}
              value={grace}
              onChange={(e) => setGrace(parseInt(e.target.value, 10) || 0)}
              className="max-w-[120px]"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("passwordPolicy.twofa.graceHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{t("passwordPolicy.session.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>{t("passwordPolicy.session.timeoutLabel")}</Label>
            <Input
              type="number"
              min={5}
              max={1440}
              value={sessionTimeout}
              onChange={(e) =>
                setSessionTimeout(parseInt(e.target.value, 10) || 60)
              }
              className="max-w-[120px]"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("passwordPolicy.session.timeoutHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          {updateMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {t("passwordPolicy.save")}
        </Button>
      </div>
    </div>
  );
}
