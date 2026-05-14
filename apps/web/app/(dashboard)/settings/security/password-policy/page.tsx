"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
    toast({ title: "Beleid opgeslagen" });
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
        Terug naar Security
      </Link>

      <PageHeader
        title="Wachtwoord- en sessie-beleid"
        description="Stel minimum-eisen voor wachtwoorden in en bepaal wie 2FA verplicht moet gebruiken."
      />

      {isLoading && (
        <div className="text-sm text-muted-foreground">Laden…</div>
      )}

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-indigo-600" />
            Wachtwoord-eisen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Minimale lengte</Label>
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
              NIST SP 800-63B raadt minimaal 8 aan. 12+ aanbevolen voor admin-accounts.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                { key: "require_uppercase", label: "Hoofdletter vereist (A–Z)" },
                { key: "require_lowercase", label: "Kleine letter vereist (a–z)" },
                { key: "require_number", label: "Cijfer vereist (0–9)" },
                { key: "require_symbol", label: "Speciaal teken vereist (!@#…)" },
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
            <Label>Wachtwoord-rotatie</Label>
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
                <SelectItem value="0">Geen rotatie</SelectItem>
                <SelectItem value="60">Elke 60 dagen</SelectItem>
                <SelectItem value="90">Elke 90 dagen</SelectItem>
                <SelectItem value="180">Elke 180 dagen</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Modern advies (NIST 2017): rotatie alleen na compromise. Beleid is
              optioneel beschikbaar voor compliance-eisen (bv. ISO 27001-A.9.4.3).
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">2FA-beleid</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Verplicht voor</Label>
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
                <SelectItem value="none">Niet verplicht</SelectItem>
                <SelectItem value="admins">Alleen voor admins</SelectItem>
                <SelectItem value="all">Voor iedereen</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(roles?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Label>Extra rollen waarvoor 2FA verplicht is</Label>
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
            <Label>Grace-period voor enrollment (dagen)</Label>
            <Input
              type="number"
              min={0}
              max={90}
              value={grace}
              onChange={(e) => setGrace(parseInt(e.target.value, 10) || 0)}
              className="max-w-[120px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Tijd die gebruikers krijgen om 2FA in te schakelen voordat ze
              uitgesloten worden van inloggen.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Sessie</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Inactiviteits-timeout (minuten)</Label>
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
              Na deze periode van inactiviteit wordt de sessie afgesloten en
              moet de gebruiker opnieuw inloggen.
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
          Beleid opslaan
        </Button>
      </div>
    </div>
  );
}
