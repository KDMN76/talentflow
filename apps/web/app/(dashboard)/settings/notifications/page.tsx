"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  BellOff,
  Loader2,
  Send,
  Smartphone,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/lib/api";
import {
  isPushSupported,
  getNotificationPermission,
  getCurrentPushSubscription,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
} from "@/lib/pushSubscription";
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from "@/hooks/useNotificationPreferences";
import type {
  NotificationEventType,
  NotificationPreferences,
  NotificationPreferencesUpdate,
} from "@talentflow/contracts";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

type EventType = NotificationEventType;

/**
 * Form-state van deze pagina. Zelfde shape als het wire-object, maar met
 * quiet-hours als string ("" = geen venster) zodat <input type="time">
 * direct kan binden. Conversie wire ↔ form: `fromWire` / `toUpdate`.
 */
type PrefsFormState = {
  push_enabled: boolean;
  events: Record<EventType, boolean>;
  quiet_hours_start: string; // "HH:MM" of "" = geen stille uren
  quiet_hours_end: string; // "HH:MM" of "" = geen stille uren
  timezone: string;
};

function fromWire(p: NotificationPreferences): PrefsFormState {
  return {
    push_enabled: p.push_enabled,
    events: { ...p.events },
    quiet_hours_start: p.quiet_hours_start ?? "",
    quiet_hours_end: p.quiet_hours_end ?? "",
    timezone: p.timezone,
  };
}

function toUpdate(p: PrefsFormState): NotificationPreferencesUpdate {
  return {
    push_enabled: p.push_enabled,
    events: { ...p.events },
    quiet_hours_start: p.quiet_hours_start === "" ? null : p.quiet_hours_start,
    quiet_hours_end: p.quiet_hours_end === "" ? null : p.quiet_hours_end,
    timezone: p.timezone,
  };
}

type RegisteredDevice = {
  id: string;
  device_label: string | null;
  user_agent: string | null;
  last_seen_at: string;
  created_at: string;
};

// EVENT_LABELS wordt binnen de component opgebouwd met vertaalde labels (t),
// zodat de teksten uit de settingsNotifications-catalogus komen. Zie hieronder.

/**
 * Placeholder tot de server-waarden geladen zijn — spiegelt de
 * server-defaults (opt-out policy: alles aan, geen stille uren).
 */
const DEFAULT_PREFS: PrefsFormState = {
  push_enabled: false,
  events: {
    new_candidate_review: true,
    scorecard_deadline: true,
    interview_reminder: true,
    application_status_change: true,
    daily_digest: true,
  },
  quiet_hours_start: "",
  quiet_hours_end: "",
  timezone: "Europe/Amsterdam",
};

const TIMEZONES = [
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "UTC",
];

// ----------------------------------------------------------------
// Page
// ----------------------------------------------------------------

export default function NotificationSettingsPage() {
  const { t } = useTranslation("settingsNotifications");
  const { toast } = useToast();
  const prefsQuery = useNotificationPreferences();

  const EVENT_LABELS: Record<EventType, { title: string; description: string }> = {
    new_candidate_review: {
      title: t("events.types.new_candidate_review.title"),
      description: t("events.types.new_candidate_review.description"),
    },
    scorecard_deadline: {
      title: t("events.types.scorecard_deadline.title"),
      description: t("events.types.scorecard_deadline.description"),
    },
    interview_reminder: {
      title: t("events.types.interview_reminder.title"),
      description: t("events.types.interview_reminder.description"),
    },
    application_status_change: {
      title: t("events.types.application_status_change.title"),
      description: t("events.types.application_status_change.description"),
    },
    daily_digest: {
      title: t("events.types.daily_digest.title"),
      description: t("events.types.daily_digest.description"),
    },
  };
  const saveMutation = useSaveNotificationPreferences();
  const [prefs, setPrefs] = useState<PrefsFormState>(DEFAULT_PREFS);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loading = devicesLoading || prefsQuery.isPending;
  const saving = saveMutation.isPending;

  // Opgeslagen voorkeuren van de server → form-state.
  useEffect(() => {
    if (prefsQuery.data) {
      setPrefs(fromWire(prefsQuery.data));
    }
  }, [prefsQuery.data]);

  // Devices + browser push-status.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const devicesRes = await api
          .get<{ devices: RegisteredDevice[] }>("/notifications/devices")
          .catch(() => null);

        if (!mounted) return;

        if (devicesRes?.data?.devices) {
          setDevices(devicesRes.data.devices);
        }

        const sub = await getCurrentPushSubscription();
        setHasSubscription(!!sub);
        setPermission(getNotificationPermission());
      } finally {
        if (mounted) setDevicesLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const supported = useMemo(() => isPushSupported(), []);

  // ----------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------

  /**
   * Sla het volledige voorkeuren-object op via PUT en toon de door de
   * server genormaliseerde staat (round-trip). Geeft `true` bij succes.
   */
  async function persist(
    next: PrefsFormState,
    opts: { silent?: boolean } = {}
  ): Promise<boolean> {
    try {
      const saved = await saveMutation.mutateAsync(toUpdate(next));
      setPrefs(fromWire(saved));
      if (!opts.silent) {
        toast({ title: t("toasts.saved.title") });
      }
      return true;
    } catch (err) {
      toast({
        title: t("toasts.saveError.title"),
        description:
          err instanceof Error ? err.message : t("toasts.saveError.description"),
        variant: "destructive",
      });
      return false;
    }
  }

  async function togglePushEnabled(enabled: boolean) {
    if (enabled) {
      setBusyAction("subscribe");
      try {
        await subscribeToPushNotifications();
        setHasSubscription(true);
        setPermission(getNotificationPermission());
        const ok = await persist(
          { ...prefs, push_enabled: true },
          { silent: true }
        );
        if (ok) {
          toast({
            title: t("toasts.pushEnabled.title"),
            description: t("toasts.pushEnabled.description"),
          });
        }
      } catch (err) {
        toast({
          title: t("toasts.enableError.title"),
          description: err instanceof Error ? err.message : t("toasts.unknownError"),
          variant: "destructive",
        });
      } finally {
        setBusyAction(null);
      }
    } else {
      setBusyAction("unsubscribe");
      try {
        await unsubscribeFromPushNotifications();
        setHasSubscription(false);
        const ok = await persist(
          { ...prefs, push_enabled: false },
          { silent: true }
        );
        if (ok) {
          toast({ title: t("toasts.pushDisabled.title") });
        }
      } finally {
        setBusyAction(null);
      }
    }
  }

  async function handleTestPush() {
    setBusyAction("test");
    try {
      await api.post("/notifications/test");
      toast({
        title: t("toasts.testSent.title"),
        description: t("toasts.testSent.description"),
      });
    } catch (err) {
      toast({
        title: t("toasts.testError.title"),
        description: err instanceof Error ? err.message : t("toasts.unknownError"),
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevoke(deviceId: string) {
    setBusyAction(`revoke-${deviceId}`);
    try {
      await api.delete(`/notifications/devices/${deviceId}`);
      setDevices((d) => d.filter((x) => x.id !== deviceId));
      toast({ title: t("toasts.deviceRevoked.title") });
    } catch (err) {
      toast({
        title: t("toasts.revokeError.title"),
        description: err instanceof Error ? err.message : t("toasts.unknownError"),
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  }

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
      />

      {/* Master toggle */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-indigo-600" />
                {t("master.title")}
              </CardTitle>
              <CardDescription>
                {t("master.description")}
              </CardDescription>
            </div>
            <ToggleSwitch
              checked={prefs.push_enabled && hasSubscription}
              disabled={!supported || busyAction === "subscribe" || busyAction === "unsubscribe"}
              onChange={togglePushEnabled}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!supported && (
            <StatusLine
              variant="warn"
              text={t("master.unsupported")}
            />
          )}
          {supported && permission === "denied" && (
            <StatusLine
              variant="warn"
              text={t("master.denied")}
            />
          )}
          {supported && hasSubscription && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleTestPush}
                disabled={busyAction === "test"}
              >
                {busyAction === "test" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t("master.testButton")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per event-type */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>{t("events.title")}</CardTitle>
          <CardDescription>
            {t("events.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {(Object.keys(EVENT_LABELS) as EventType[]).map((evt, idx) => {
            const meta = EVENT_LABELS[evt];
            const enabled = prefs.events[evt];
            return (
              <div key={evt}>
                {idx > 0 && <Separator className="my-2" />}
                <div className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {meta.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {meta.description}
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={enabled}
                    disabled={loading || saving || !prefs.push_enabled}
                    onChange={(next) =>
                      persist({
                        ...prefs,
                        events: { ...prefs.events, [evt]: next },
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Quiet hours */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>{t("quietHours.title")}</CardTitle>
          <CardDescription>
            {t("quietHours.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="quiet-start">{t("quietHours.startLabel")}</Label>
              <Input
                id="quiet-start"
                type="time"
                value={prefs.quiet_hours_start}
                onChange={(e) =>
                  setPrefs({ ...prefs, quiet_hours_start: e.target.value })
                }
                onBlur={() => persist(prefs)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-end">{t("quietHours.endLabel")}</Label>
              <Input
                id="quiet-end"
                type="time"
                value={prefs.quiet_hours_end}
                onChange={(e) =>
                  setPrefs({ ...prefs, quiet_hours_end: e.target.value })
                }
                onBlur={() => persist(prefs)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-tz">{t("quietHours.timezoneLabel")}</Label>
              <Select
                value={prefs.timezone}
                onValueChange={(v) =>
                  persist({ ...prefs, timezone: v })
                }
              >
                <SelectTrigger id="quiet-tz">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Devices */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>{t("devices.title")}</CardTitle>
          <CardDescription>
            {t("devices.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("devices.loading")}</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("devices.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {devices.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      <Smartphone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {d.device_label || t("devices.unknownDevice")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("devices.lastActive", {
                          date: new Date(d.last_seen_at).toLocaleString("nl-NL", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" />
                      {t("devices.active")}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busyAction === `revoke-${d.id}`}
                      onClick={() => handleRevoke(d.id)}
                      aria-label={t("devices.revokeAria", { label: d.device_label })}
                    >
                      {busyAction === `revoke-${d.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-red-500" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void | Promise<unknown>;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "bg-indigo-600"
          : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function StatusLine({
  variant,
  text,
}: {
  variant: "warn" | "info";
  text: string;
}) {
  const cls =
    variant === "warn"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300 border-amber-200 dark:border-amber-900/50"
      : "bg-indigo-50 text-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/50";
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${cls}`}>
      <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
