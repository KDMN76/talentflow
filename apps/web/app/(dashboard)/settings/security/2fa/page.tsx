"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  useTwoFactorStatus,
  useSetup2fa,
  useVerify2fa,
  useDisable2fa,
  useRegenerateBackupCodes,
} from "@/hooks/useSecurity";
import { cn } from "@/lib/utils";

const APP_LINKS = [
  {
    name: "Google Authenticator",
    ios: "https://apps.apple.com/app/google-authenticator/id388497605",
    android:
      "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2",
  },
  {
    name: "Authy",
    ios: "https://apps.apple.com/app/twilio-authy/id494168017",
    android:
      "https://play.google.com/store/apps/details?id=com.authy.authy",
  },
  {
    name: "1Password",
    ios: "https://apps.apple.com/app/1password-7-password-manager/id1333542190",
    android: "https://play.google.com/store/apps/details?id=com.onepassword.android",
  },
  { name: "Microsoft Authenticator", ios: "https://apps.apple.com/app/microsoft-authenticator/id983156458", android: "https://play.google.com/store/apps/details?id=com.azure.authenticator" },
];

export default function TwoFactorPage() {
  const { toast } = useToast();
  const { data: status, isLoading } = useTwoFactorStatus();
  const setupMutation = useSetup2fa();
  const verifyMutation = useVerify2fa();
  const disableMutation = useDisable2fa();
  const regenerateMutation = useRegenerateBackupCodes();

  const [step, setStep] = useState<"idle" | "scan" | "verify" | "backup" | "done">(
    "idle"
  );
  const [setupData, setSetupData] = useState<{
    secret: string;
    qr_code_data_url: string;
    backup_codes: string[];
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  // Disable-flow
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  // Regenerate-flow
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  useEffect(() => {
    // Reset wizard wanneer status verandert (bv. na disable van elders).
    if (status?.enabled) {
      setStep("done");
    } else {
      setStep("idle");
    }
  }, [status?.enabled]);

  const handleStart = async () => {
    const data = await setupMutation.mutateAsync();
    setSetupData(data);
    setStep("scan");
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(verifyCode)) {
      toast({
        title: "Ongeldige code",
        description: "Voer 6 cijfers in van je authenticator-app.",
        variant: "destructive",
      });
      return;
    }
    try {
      await verifyMutation.mutateAsync({ code: verifyCode });
      setStep("backup");
      toast({ title: "2FA geverifieerd", description: "Bewaar nu je backup-codes." });
    } catch (err) {
      toast({
        title: "Verificatie mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout.",
        variant: "destructive",
      });
    }
  };

  const handleFinish = () => {
    setStep("done");
    setVerifyCode("");
    setSetupData(null);
    setSavedConfirmed(false);
  };

  const handleDisable = async () => {
    try {
      await disableMutation.mutateAsync({ code: disableCode });
      setDisableOpen(false);
      setDisableCode("");
      toast({ title: "2FA uitgeschakeld" });
    } catch (err) {
      toast({
        title: "Uitschakelen mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout.",
        variant: "destructive",
      });
    }
  };

  const handleRegenerate = async () => {
    try {
      const r = await regenerateMutation.mutateAsync({ code: regenCode });
      setNewCodes(r.backup_codes);
      setRegenCode("");
      toast({ title: "Nieuwe backup-codes gegenereerd" });
    } catch (err) {
      toast({
        title: "Mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout.",
        variant: "destructive",
      });
    }
  };

  const handleCopyCodes = (codes: string[]) => {
    navigator.clipboard.writeText(codes.join("\n"));
    toast({ title: "Codes gekopieerd" });
  };

  const handleDownloadCodes = (codes: string[]) => {
    const blob = new Blob(
      [
        `TalentFlow — 2FA backup-codes\nGegenereerd: ${new Date().toLocaleString("nl-NL")}\n\n${codes.join("\n")}\n\nBewaar dit bestand veilig. Elke code is eenmalig bruikbaar.`,
      ],
      { type: "text/plain;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `talentflow-backup-codes-${new Date()
      .toISOString()
      .slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const policyBanner =
    status?.required_by_policy && !status.enabled ? (
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            2FA is verplicht voor jouw rol
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {status.policy_grace_period_ends_at
              ? `Schakel 2FA in vóór ${new Date(
                  status.policy_grace_period_ends_at
                ).toLocaleString("nl-NL")} — daarna kun je niet meer inloggen zonder.`
              : "Schakel 2FA in om toegang te behouden."}
          </p>
        </div>
      </div>
    ) : null;

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
        title="Twee-factor-authenticatie"
        description="Voeg een tweede beveiligingslaag toe aan je account met een TOTP-app."
        actions={
          status?.enabled ? (
            <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0">
              <CheckCircle2 className="h-3 w-3" />
              Ingeschakeld
            </Badge>
          ) : (
            <Badge className="gap-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0">
              Niet ingeschakeld
            </Badge>
          )
        }
      />

      {policyBanner}

      {isLoading && (
        <div className="text-sm text-muted-foreground">Laden…</div>
      )}

      {/* INGESCHAKELD STATE */}
      {status?.enabled && step === "done" && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">2FA is actief</p>
                <p className="text-xs text-muted-foreground">
                  {status.enrolled_at
                    ? `Ingeschakeld op ${new Date(
                        status.enrolled_at
                      ).toLocaleString("nl-NL")}.`
                    : "Ingeschakeld."}{" "}
                  Backup-codes resterend: {status.backup_codes_remaining} / 10.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setRegenOpen(true)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Backup-codes opnieuw genereren
              </Button>
              <Button
                variant="outline"
                onClick={() => setDisableOpen(true)}
                className="text-destructive border-destructive/50 hover:bg-destructive/10"
              >
                <ShieldOff className="mr-2 h-4 w-4" />
                2FA uitschakelen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* IDLE — start setup */}
      {!status?.enabled && step === "idle" && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center">
                <Smartphone className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold">
                  Schakel 2FA in voor extra beveiliging
                </p>
                <p className="text-xs text-muted-foreground">
                  Je gebruikt elke 30 seconden een 6-cijferige code uit een
                  authenticator-app naast je wachtwoord.
                </p>
              </div>
            </div>
            <Button
              onClick={handleStart}
              disabled={setupMutation.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              {setupMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Schakel 2FA in
            </Button>
          </CardContent>
        </Card>
      )}

      {/* SCAN */}
      {step === "scan" && setupData && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">
              Stap 1 — Scan QR met je authenticator-app
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="rounded-lg border border-border bg-white p-3 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={setupData.qr_code_data_url}
                  alt="2FA QR-code"
                  width={200}
                  height={200}
                  className="block"
                />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-xs font-medium mb-1">
                    Geen QR-scanner? Voer handmatig in:
                  </p>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={setupData.secret}
                      className="font-mono text-xs"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(setupData.secret);
                        toast({ title: "Secret gekopieerd" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium mb-2">Geen app? Download:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {APP_LINKS.map((a) => (
                      <span
                        key={a.name}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
                      >
                        {a.name}
                        <a
                          href={a.ios}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          iOS
                        </a>
                        <span className="text-muted-foreground">·</span>
                        <a
                          href={a.android}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          Android
                        </a>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border space-y-2">
              <Label>
                Stap 2 — Voer de 6-cijferige code uit je app in
              </Label>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="123456"
                  className="font-mono text-lg text-center tracking-widest max-w-[180px]"
                  value={verifyCode}
                  onChange={(e) =>
                    setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <Button
                  onClick={handleVerify}
                  disabled={verifyMutation.isPending || verifyCode.length !== 6}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {verifyMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Verifiëren
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* BACKUP CODES */}
      {step === "backup" && setupData && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">
              Stap 3 — Bewaar je backup-codes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
                <p className="font-medium">
                  Bewaar deze codes nu — ze zijn hierna niet meer zichtbaar.
                </p>
                <p>
                  Elke code is eenmalig bruikbaar als alternatief voor je
                  TOTP-app (bv. wanneer je je telefoon kwijt bent).
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {setupData.backup_codes.map((c) => (
                <code
                  key={c}
                  className="font-mono text-sm bg-zinc-100 dark:bg-zinc-800 rounded px-2.5 py-2 text-center"
                >
                  {c}
                </code>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => handleCopyCodes(setupData.backup_codes)}
              >
                <Copy className="mr-2 h-4 w-4" />
                Kopieer
              </Button>
              <Button
                variant="outline"
                onClick={() => handleDownloadCodes(setupData.backup_codes)}
              >
                <Download className="mr-2 h-4 w-4" />
                Download als .txt
              </Button>
            </div>

            <label className="flex items-center gap-2 pt-3 border-t border-border cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-indigo-600"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
              />
              <span className="text-sm">
                Ik heb deze codes veilig opgeslagen.
              </span>
            </label>
            <Button
              onClick={handleFinish}
              disabled={!savedConfirmed}
              className="bg-emerald-600 hover:bg-emerald-700 border-0"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              2FA-setup afronden
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Disable dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>2FA uitschakelen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Hierdoor kun je weer inloggen met alleen wachtwoord. We raden
              aan dit alleen tijdelijk te doen.
            </div>
            <Label>2FA-code (TOTP of backup-code)</Label>
            <Input
              placeholder="123456 of XXXXX-XXXXX"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              className="font-mono"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDisableOpen(false)}>
              Annuleren
            </Button>
            <Button
              onClick={handleDisable}
              disabled={disableMutation.isPending || !disableCode}
              variant="destructive"
            >
              {disableMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Uitschakelen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate dialog */}
      <Dialog
        open={regenOpen}
        onOpenChange={(o) => {
          setRegenOpen(o);
          if (!o) setNewCodes(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Backup-codes opnieuw genereren</DialogTitle>
          </DialogHeader>
          {!newCodes ? (
            <>
              <div className="space-y-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Oude codes worden ongeldig zodra je dit bevestigt.
                </p>
                <Label>2FA-code</Label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={regenCode}
                  onChange={(e) =>
                    setRegenCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="font-mono"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setRegenOpen(false)}>
                  Annuleren
                </Button>
                <Button
                  onClick={handleRegenerate}
                  disabled={regenerateMutation.isPending || regenCode.length !== 6}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {regenerateMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Genereren
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-2">
                  {newCodes.map((c) => (
                    <code
                      key={c}
                      className={cn(
                        "font-mono text-sm rounded px-2.5 py-2 text-center",
                        "bg-zinc-100 dark:bg-zinc-800"
                      )}
                    >
                      {c}
                    </code>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyCodes(newCodes)}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Kopieer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownloadCodes(newCodes)}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setRegenOpen(false)}>Sluiten</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
