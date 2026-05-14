"use client";

import { useEffect, useMemo, useState } from "react";
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

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

type EventType =
  | "new_candidate_review"
  | "scorecard_deadline"
  | "interview_reminder"
  | "application_status_change"
  | "daily_digest";

type NotificationPreferences = {
  push_enabled: boolean;
  events: Record<EventType, boolean>;
  quiet_hours_start: string; // "HH:MM"
  quiet_hours_end: string; // "HH:MM"
  timezone: string;
};

type RegisteredDevice = {
  id: string;
  device_label: string | null;
  user_agent: string | null;
  last_seen_at: string;
  created_at: string;
};

const EVENT_LABELS: Record<EventType, { title: string; description: string }> = {
  new_candidate_review: {
    title: "Nieuwe kandidaat te beoordelen",
    description: "Direct seintje als er een sollicitatie op je wacht.",
  },
  scorecard_deadline: {
    title: "Scorecard-deadline",
    description: "Reminder voordat een scorecard te laat is.",
  },
  interview_reminder: {
    title: "Interview-herinnering",
    description: "15 minuten voor een geplande sollicitatiegesprek.",
  },
  application_status_change: {
    title: "Status van sollicitatie wijzigt",
    description: "Bij goedkeuren, afwijzen of doorzetten naar volgende fase.",
  },
  daily_digest: {
    title: "Dagelijkse samenvatting",
    description: "Eén overzichtsbericht per dag (in plaats van losse meldingen).",
  },
};

const DEFAULT_PREFS: NotificationPreferences = {
  push_enabled: false,
  events: {
    new_candidate_review: true,
    scorecard_deadline: true,
    interview_reminder: true,
    application_status_change: false,
    daily_digest: false,
  },
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
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
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [prefsRes, devicesRes] = await Promise.all([
          api.get<NotificationPreferences>("/notifications/preferences").catch(() => null),
          api.get<{ devices: RegisteredDevice[] }>("/notifications/devices").catch(() => null),
        ]);

        if (!mounted) return;

        if (prefsRes?.data) {
          setPrefs({ ...DEFAULT_PREFS, ...prefsRes.data });
        }
        if (devicesRes?.data?.devices) {
          setDevices(devicesRes.data.devices);
        }

        const sub = await getCurrentPushSubscription();
        setHasSubscription(!!sub);
        setPermission(getNotificationPermission());
      } finally {
        if (mounted) setLoading(false);
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

  async function persist(next: NotificationPreferences) {
    setSaving(true);
    try {
      await api.put("/notifications/preferences", next);
      setPrefs(next);
    } catch (err) {
      toast({
        title: "Opslaan mislukt",
        description: err instanceof Error ? err.message : "Probeer opnieuw.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function togglePushEnabled(enabled: boolean) {
    if (enabled) {
      setBusyAction("subscribe");
      try {
        await subscribeToPushNotifications();
        setHasSubscription(true);
        setPermission(getNotificationPermission());
        await persist({ ...prefs, push_enabled: true });
        toast({
          title: "Push ingeschakeld",
          description: "Je ontvangt nu meldingen op dit apparaat.",
        });
      } catch (err) {
        toast({
          title: "Inschakelen mislukt",
          description: err instanceof Error ? err.message : "Onbekende fout",
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
        await persist({ ...prefs, push_enabled: false });
        toast({ title: "Push uitgeschakeld" });
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
        title: "Test-melding verstuurd",
        description: "Je zou hem binnen enkele seconden moeten zien.",
      });
    } catch (err) {
      toast({
        title: "Test-melding mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout",
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
      toast({ title: "Apparaat ingetrokken" });
    } catch (err) {
      toast({
        title: "Intrekken mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout",
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
        title="Meldingen"
        description="Bepaal welke push-notificaties je ontvangt en wanneer."
      />

      {/* Master toggle */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-indigo-600" />
                Push-meldingen
              </CardTitle>
              <CardDescription>
                Krijg een seintje op je telefoon of desktop.
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
              text="Deze browser ondersteunt geen push-notificaties."
            />
          )}
          {supported && permission === "denied" && (
            <StatusLine
              variant="warn"
              text="Meldingen zijn geblokkeerd in je browser. Wijzig dit in de site-instellingen om ze opnieuw te activeren."
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
                Verstuur test-melding
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per event-type */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Per type</CardTitle>
          <CardDescription>
            Schakel specifieke event-types uit als je er teveel krijgt.
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
          <CardTitle>Stille uren</CardTitle>
          <CardDescription>
            Tijdens deze uren worden meldingen niet verstuurd (alleen
            kritieke uitzonderingen).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="quiet-start">Start</Label>
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
              <Label htmlFor="quiet-end">Einde</Label>
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
              <Label htmlFor="quiet-tz">Tijdzone</Label>
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
          <CardTitle>Geregistreerde apparaten</CardTitle>
          <CardDescription>
            Apparaten die meldingen ontvangen. Verwijder verloren of niet
            meer gebruikte apparaten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Laden...</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nog geen apparaten geregistreerd.
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
                        {d.device_label || "Onbekend apparaat"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Laatst actief:{" "}
                        {new Date(d.last_seen_at).toLocaleString("nl-NL", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" />
                      Actief
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busyAction === `revoke-${d.id}`}
                      onClick={() => handleRevoke(d.id)}
                      aria-label={`Apparaat ${d.device_label} intrekken`}
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
  onChange: (next: boolean) => void | Promise<void>;
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
