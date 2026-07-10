"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useAvailability,
  useSetAvailability,
} from "@/hooks/useAvailability";
import { useCurrentUser } from "@/hooks/useUsers";
import type {
  AvailabilityOverride,
  RecurringHours,
  Weekday,
} from "@/lib/types/interviews";

/**
 * Lokale, bewerkbare rij voor een uitzondering (van–t/m + reden). `id` is
 * enkel een client-side key voor de lijst; de server kent geen override-id.
 */
type OverrideDraft = {
  id: string;
  date: string; // van, YYYY-MM-DD
  dateEnd: string; // t/m, YYYY-MM-DD
  reason: string;
};

function makeOverrideId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ov-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const WEEKDAYS: Array<{ value: Weekday; short: string }> = [
  { value: "monday", short: "Ma" },
  { value: "tuesday", short: "Di" },
  { value: "wednesday", short: "Wo" },
  { value: "thursday", short: "Do" },
  { value: "friday", short: "Vr" },
  { value: "saturday", short: "Za" },
  { value: "sunday", short: "Zo" },
];

const TIMEZONES = [
  "Europe/Amsterdam",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
];

export default function AvailabilitySettingsPage() {
  const { t } = useTranslation("settingsAdvanced");
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const userId = currentUser?.id ?? null;
  const { toast } = useToast();
  const { data, isLoading, isError } = useAvailability(userId);
  const save = useSetAvailability(userId ?? "");

  const [timezone, setTimezone] = useState("Europe/Amsterdam");
  const [hours, setHours] = useState<RecurringHours[]>([]);
  const [overrides, setOverrides] = useState<OverrideDraft[]>([]);

  useEffect(() => {
    if (!data) return;
    // Guards: een tenant zonder beschikbaarheid kan een lege/afwijkende shape
    // teruggeven; zonder deze guards werd `hours` undefined en crashte
    // `hours.filter` de pagina (witte pagina /settings/availability).
    if (data.timezone) setTimezone(data.timezone);
    setHours(Array.isArray(data.recurring_hours) ? data.recurring_hours : []);
    const serverOverrides = Array.isArray(data.overrides) ? data.overrides : [];
    setOverrides(
      serverOverrides
        .filter((o) => !o.available)
        .map((o) => ({
          id: makeOverrideId(),
          date: o.date,
          dateEnd: o.date_end ?? o.date,
          reason: o.reason ?? "",
        }))
    );
  }, [data]);

  const blocksForDay = (day: Weekday): RecurringHours[] =>
    (hours ?? []).filter((h) => h.weekday === day);

  const addBlock = (day: Weekday) =>
    setHours((cur) => [
      ...cur,
      { weekday: day, start: "09:00", end: "17:00" },
    ]);

  const updateBlock = (
    day: Weekday,
    idxInDay: number,
    patch: Partial<RecurringHours>
  ) => {
    setHours((cur) => {
      let count = -1;
      return cur.map((h) => {
        if (h.weekday !== day) return h;
        count++;
        return count === idxInDay ? { ...h, ...patch } : h;
      });
    });
  };

  const removeBlock = (day: Weekday, idxInDay: number) => {
    setHours((cur) => {
      let count = -1;
      return cur.filter((h) => {
        if (h.weekday !== day) return true;
        count++;
        return count !== idxInDay;
      });
    });
  };

  const addOverride = () =>
    setOverrides((cur) => [
      ...cur,
      { id: makeOverrideId(), date: "", dateEnd: "", reason: "" },
    ]);

  const updateOverride = (id: string, patch: Partial<Omit<OverrideDraft, "id">>) =>
    setOverrides((cur) =>
      cur.map((o) => {
        if (o.id !== id) return o;
        const next = { ...o, ...patch };
        // Als 'van' verandert en 't/m' leeg is of vóór 'van' ligt: sync 't/m'.
        if (patch.date && (!next.dateEnd || next.dateEnd < patch.date)) {
          next.dateEnd = patch.date;
        }
        return next;
      })
    );

  const removeOverride = (id: string) =>
    setOverrides((cur) => cur.filter((o) => o.id !== id));

  const handleSave = async () => {
    // Valideer periodes vóór we opslaan: t/m mag niet vóór van liggen.
    for (const o of overrides) {
      if (!o.date) continue;
      const end = o.dateEnd || o.date;
      if (end < o.date) {
        toast({
          title: t("availability.toast.error.title"),
          description: t("availability.overrides.rangeError"),
          variant: "destructive",
        });
        return;
      }
    }

    const overridesPayload: AvailabilityOverride[] = overrides
      .filter((o) => o.date)
      .map((o) => ({
        date: o.date,
        date_end: o.dateEnd || o.date,
        available: false,
        reason: o.reason.trim() || null,
      }));

    try {
      await save.mutateAsync({
        timezone,
        recurring_hours: hours,
        overrides: overridesPayload,
      });
      toast({
        title: t("availability.toast.saved.title"),
        description: t("availability.toast.saved.description", {
          count: hours.length,
          timezone,
        }),
      });
    } catch (err) {
      toast({
        title: t("availability.toast.error.title"),
        description:
          err instanceof Error
            ? err.message
            : t("availability.toast.error.description"),
        variant: "destructive",
      });
    }
  };

  if (userLoading || isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !userId) {
    return (
      <div className="space-y-4">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-zinc-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("availability.backToSettings")}
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-sm text-destructive">
            {t("availability.loadError")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Terug naar instellingen
      </Link>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("availability.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("availability.description")}
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={save.isPending}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {save.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {t("availability.save")}
        </Button>
      </div>

      {/* Timezone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-500" />
            {t("availability.timezone.title")}
          </CardTitle>
          <CardDescription>
            {t("availability.timezone.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger className="w-full sm:w-72">
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
        </CardContent>
      </Card>

      {/* Weekly schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-purple-500" />
            {t("availability.weeklySchedule.title")}
          </CardTitle>
          <CardDescription>
            {t("availability.weeklySchedule.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {WEEKDAYS.map((day) => (
            <div
              key={day.value}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">
                  {t(`availability.weekdays.${day.value}`)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addBlock(day.value)}
                  className="h-7"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("availability.weeklySchedule.addBlock")}
                </Button>
              </div>
              {blocksForDay(day.value).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {t("availability.weeklySchedule.notAvailable")}
                </p>
              ) : (
                <div className="space-y-2">
                  {blocksForDay(day.value).map((block, idxInDay) => (
                    <div key={idxInDay} className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={block.start}
                        onChange={(e) =>
                          updateBlock(day.value, idxInDay, {
                            start: e.target.value,
                          })
                        }
                        className="w-28"
                      />
                      <span className="text-xs text-muted-foreground">
                        {t("availability.weeklySchedule.until")}
                      </span>
                      <Input
                        type="time"
                        value={block.end}
                        onChange={(e) =>
                          updateBlock(day.value, idxInDay, {
                            end: e.target.value,
                          })
                        }
                        className="w-28"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-rose-500 hover:text-rose-600"
                        onClick={() => removeBlock(day.value, idxInDay)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Date overrides */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-amber-500" />
            {t("availability.overrides.title")}
          </CardTitle>
          <CardDescription>
            {t("availability.overrides.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {overrides.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {t("availability.overrides.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {overrides.map((o) => (
                <div
                  key={o.id}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end rounded-lg border border-border p-3"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={`ov-from-${o.id}`}>
                      {t("availability.overrides.fromLabel")}
                    </Label>
                    <Input
                      id={`ov-from-${o.id}`}
                      type="date"
                      value={o.date}
                      onChange={(e) =>
                        updateOverride(o.id, { date: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ov-to-${o.id}`}>
                      {t("availability.overrides.toLabel")}
                    </Label>
                    <Input
                      id={`ov-to-${o.id}`}
                      type="date"
                      value={o.dateEnd}
                      min={o.date || undefined}
                      onChange={(e) =>
                        updateOverride(o.id, { dateEnd: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ov-reason-${o.id}`}>
                      {t("availability.overrides.reasonLabel")}
                    </Label>
                    <Input
                      id={`ov-reason-${o.id}`}
                      value={o.reason}
                      onChange={(e) =>
                        updateOverride(o.id, { reason: e.target.value })
                      }
                      placeholder={t("availability.overrides.reasonPlaceholder")}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-rose-500 hover:text-rose-600 justify-self-end"
                    onClick={() => removeOverride(o.id)}
                    aria-label={t("availability.overrides.removeAria")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button onClick={addOverride} variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("availability.overrides.blockDate")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
