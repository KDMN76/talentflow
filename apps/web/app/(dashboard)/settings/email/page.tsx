"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AtSign,
  Loader2,
  Lock,
  Mail,
  Reply,
  Save,
  Send,
  Server,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useUsers";
import {
  useTenantEmailSettings,
  useUpdateTenantEmailSettings,
  useSendTestEmail,
  type TenantEmailSettings,
} from "@/hooks/useTenantEmailSettings";

interface FormState {
  from_name: string;
  reply_to: string;
  smtp_enabled: boolean;
  smtp_host: string;
  smtp_port: string; // string in het formulier; leeg = server-default
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string; // write-only: leeg = ongewijzigd laten
  smtp_from: string;
}

function toFormState(s: TenantEmailSettings): FormState {
  return {
    from_name: s.from_name ?? "",
    reply_to: s.reply_to ?? "",
    smtp_enabled: s.smtp_enabled,
    smtp_host: s.smtp_host ?? "",
    smtp_port: s.smtp_port !== null ? String(s.smtp_port) : "",
    smtp_secure: s.smtp_secure,
    smtp_user: s.smtp_user ?? "",
    smtp_pass: "",
    smtp_from: s.smtp_from ?? "",
  };
}

export default function EmailSettingsPage() {
  const { t } = useTranslation("settingsCore");
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const { data: settings, isLoading } = useTenantEmailSettings();
  const update = useUpdateTenantEmailSettings();
  const sendTest = useSendTestEmail();

  const [form, setForm] = useState<FormState | null>(null);
  const [clearPass, setClearPass] = useState(false);

  useEffect(() => {
    if (settings && !form) setForm(toFormState(settings));
  }, [settings, form]);

  const isAdmin =
    currentUser?.role === "admin" || currentUser?.role === "super_admin";

  if (currentUser && !isAdmin) {
    return (
      <div className="space-y-6 p-6">
        <Card className="border-amber-200 dark:border-amber-900/40">
          <CardContent className="flex items-start gap-3 p-5">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm text-zinc-700 dark:text-zinc-300">
              {t("email.adminOnly")}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !form || !settings) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const fromPreview = `${form.from_name.trim() || "TalentFlow"} <${
    settings.global_from_address
  }>`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.smtp_enabled && !form.smtp_host.trim()) {
      toast({
        variant: "destructive",
        title: t("email.toasts.hostRequired.title"),
        description: t("email.toasts.hostRequired.description"),
      });
      return;
    }
    const port = form.smtp_port.trim() === "" ? null : Number(form.smtp_port);
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      toast({
        variant: "destructive",
        title: t("email.toasts.invalidPort.title"),
        description: t("email.toasts.invalidPort.description"),
      });
      return;
    }

    update.mutate(
      {
        from_name: form.from_name.trim() || null,
        reply_to: form.reply_to.trim() || null,
        smtp_enabled: form.smtp_enabled,
        smtp_host: form.smtp_host.trim() || null,
        smtp_port: port,
        smtp_secure: form.smtp_secure,
        smtp_user: form.smtp_user.trim() || null,
        smtp_from: form.smtp_from.trim() || null,
        // Write-only: alleen meesturen bij nieuw wachtwoord of expliciet wissen.
        ...(form.smtp_pass !== ""
          ? { smtp_pass: form.smtp_pass }
          : clearPass
            ? { smtp_pass: null }
            : {}),
      },
      {
        onSuccess: (fresh) => {
          setForm(toFormState(fresh));
          setClearPass(false);
          toast({
            title: t("email.toasts.saved.title"),
            description: t("email.toasts.saved.description"),
          });
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: t("email.toasts.saveError.title"),
            description: t("email.toasts.saveError.description"),
          }),
      }
    );
  };

  const handleTest = () => {
    sendTest.mutate(undefined, {
      onSuccess: (result) =>
        toast({
          title: t("email.toasts.testSent.title"),
          description: t("email.toasts.testSent.description", {
            to: result.to,
            provider: result.provider === "smtp" ? "SMTP" : "Resend",
          }),
        }),
      onError: (err: unknown) => {
        const message =
          (err as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? t("email.toasts.testError.description");
        toast({
          variant: "destructive",
          title: t("email.toasts.testError.title"),
          description: message,
        });
      },
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {t("email.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("email.description")}</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Afzender */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AtSign className="h-4 w-4 text-indigo-500" />
                {t("email.sender.title")}
              </CardTitle>
              <CardDescription>{t("email.sender.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="from_name">{t("email.sender.fromNameLabel")}</Label>
                <Input
                  id="from_name"
                  placeholder={t("email.sender.fromNamePlaceholder")}
                  value={form.from_name}
                  onChange={(e) => setField("from_name", e.target.value)}
                  maxLength={200}
                />
                <p className="text-xs text-muted-foreground">
                  {t("email.sender.fromNameHint")}{" "}
                  <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                    {fromPreview}
                  </span>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reply_to" className="flex items-center gap-1.5">
                  <Reply className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("email.sender.replyToLabel")}
                </Label>
                <Input
                  id="reply_to"
                  type="email"
                  placeholder={t("email.sender.replyToPlaceholder")}
                  value={form.reply_to}
                  onChange={(e) => setField("reply_to", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("email.sender.replyToHint")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Eigen SMTP */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Server className="h-4 w-4 text-purple-500" />
                    {t("email.smtp.title")}
                  </CardTitle>
                  <CardDescription>{t("email.smtp.description")}</CardDescription>
                </div>
                <Switch
                  checked={form.smtp_enabled}
                  onCheckedChange={(v) => setField("smtp_enabled", v)}
                  aria-label={t("email.smtp.enabledAria")}
                />
              </div>
            </CardHeader>
            {form.smtp_enabled && (
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="smtp_host">{t("email.smtp.hostLabel")}</Label>
                    <Input
                      id="smtp_host"
                      placeholder="smtp.jouwdomein.nl"
                      value={form.smtp_host}
                      onChange={(e) => setField("smtp_host", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_port">{t("email.smtp.portLabel")}</Label>
                    <Input
                      id="smtp_port"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder={form.smtp_secure ? "465" : "587"}
                      value={form.smtp_port}
                      onChange={(e) => setField("smtp_port", e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {t("email.smtp.secureLabel")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("email.smtp.secureHint")}
                    </p>
                  </div>
                  <Switch
                    checked={form.smtp_secure}
                    onCheckedChange={(v) => setField("smtp_secure", v)}
                    aria-label={t("email.smtp.secureLabel")}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="smtp_user">{t("email.smtp.userLabel")}</Label>
                    <Input
                      id="smtp_user"
                      autoComplete="off"
                      placeholder="mailer@jouwdomein.nl"
                      value={form.smtp_user}
                      onChange={(e) => setField("smtp_user", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_pass" className="flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      {t("email.smtp.passLabel")}
                    </Label>
                    <Input
                      id="smtp_pass"
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        settings.smtp_pass_set && !clearPass
                          ? t("email.smtp.passSetPlaceholder")
                          : t("email.smtp.passPlaceholder")
                      }
                      value={form.smtp_pass}
                      onChange={(e) => {
                        setField("smtp_pass", e.target.value);
                        if (e.target.value !== "") setClearPass(false);
                      }}
                    />
                    {settings.smtp_pass_set && form.smtp_pass === "" && (
                      <button
                        type="button"
                        className="text-xs text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                        onClick={() => setClearPass((v) => !v)}
                      >
                        {clearPass
                          ? t("email.smtp.passClearUndo")
                          : t("email.smtp.passClear")}
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtp_from">{t("email.smtp.fromLabel")}</Label>
                  <Input
                    id="smtp_from"
                    type="email"
                    placeholder="no-reply@jouwdomein.nl"
                    value={form.smtp_from}
                    onChange={(e) => setField("smtp_from", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("email.smtp.fromHint")}
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t("email.save")}
            </Button>
          </div>
        </div>

        {/* Test-lane */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4 text-indigo-500" />
                {t("email.test.title")}
              </CardTitle>
              <CardDescription>{t("email.test.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-zinc-50 p-3 text-xs text-muted-foreground dark:bg-zinc-900/40">
                {t("email.test.targetHint", {
                  email: currentUser?.email ?? "…",
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleTest}
                disabled={sendTest.isPending || update.isPending}
              >
                {sendTest.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {t("email.test.button")}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {t("email.test.savedFirstHint")}
              </p>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
