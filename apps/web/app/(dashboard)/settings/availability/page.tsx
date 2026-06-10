"use client";

import { useEffect, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
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
  useAddAvailabilityOverride,
  useAvailability,
  useSetAvailability,
} from "@/hooks/useAvailability";
import { useCurrentUser } from "@/hooks/useUsers";
import type {
  AvailabilityOverride,
  RecurringHours,
  Weekday,
} from "@/lib/types/interviews";

const WEEKDAYS: Array<{ value: Weekday; label: string; short: string }> = [
  { value: "monday", label: "Maandag", short: "Ma" },
  { value: "tuesday", label: "Dinsdag", short: "Di" },
  { value: "wednesday", label: "Woensdag", short: "Wo" },
  { value: "thursday", label: "Donderdag", short: "Do" },
  { value: "friday", label: "Vrijdag", short: "Vr" },
  { value: "saturday", label: "Zaterdag", short: "Za" },
  { value: "sunday", label: "Zondag", short: "Zo" },
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
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const userId = currentUser?.id ?? null;
  const { toast } = useToast();
  const { data, isLoading, isError } = useAvailability(userId);
  const save = useSetAvailability(userId ?? "");
  const addOverride = useAddAvailabilityOverride(userId ?? "");

  const [timezone, setTimezone] = useState("Europe/Amsterdam");
  const [hours, setHours] = useState<RecurringHours[]>([]);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    if (!data) return;
    // Guards: een tenant zonder beschikbaarheid kan een lege/afwijkende shape
    // teruggeven; zonder deze guards werd `hours` undefined en crashte
    // `hours.filter` de pagina (witte pagina /settings/availability).
    if (data.timezone) setTimezone(data.timezone);
    setHours(Array.isArray(data.recurring_hours) ? data.recurring_hours : []);
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

  const handleSave = async () => {
    await save.mutateAsync({ timezone, recurring_hours: hours });
    toast({
      title: "Beschikbaarheid opgeslagen",
      description: `${hours.length} blokken · ${timezone}`,
    });
  };

  const handleAddOverride = async () => {
    if (!overrideDate) return;
    const ov: AvailabilityOverride = {
      date: overrideDate,
      available: false,
      reason: overrideReason.trim() || null,
    };
    await addOverride.mutateAsync(ov);
    toast({
      title: "Datum geblokkeerd",
      description: `${overrideDate}${overrideReason ? ` — ${overrideReason}` : ""}`,
    });
    setOverrideDate("");
    setOverrideReason("");
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
          Terug naar instellingen
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-sm text-destructive">
            Kon beschikbaarheid niet laden — probeer opnieuw.
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
          <h1 className="text-xl font-bold tracking-tight">Beschikbaarheid</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Geef aan wanneer je standaard beschikbaar bent voor interviews. De
            scheduler gebruikt deze tijden om slots voor te stellen.
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
          Opslaan
        </Button>
      </div>

      {/* Timezone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-500" />
            Tijdzone
          </CardTitle>
          <CardDescription>
            Tijden worden opgeslagen in deze tijdzone.
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
            Wekelijks schema
          </CardTitle>
          <CardDescription>
            Voeg per dag één of meerdere tijdblokken toe (bv. ochtend en
            middag).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {WEEKDAYS.map((day) => (
            <div
              key={day.value}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">{day.label}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addBlock(day.value)}
                  className="h-7"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Voeg toe
                </Button>
              </div>
              {blocksForDay(day.value).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Niet beschikbaar
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
                      <span className="text-xs text-muted-foreground">tot</span>
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
            Specifieke datum-uitzonderingen
          </CardTitle>
          <CardDescription>
            Blokkeer individuele dagen (vakantie, ziek, externe afspraken).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ov-date">Datum</Label>
              <Input
                id="ov-date"
                type="date"
                value={overrideDate}
                onChange={(e) => setOverrideDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ov-reason">Reden (optioneel)</Label>
              <Input
                id="ov-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="bv. Vakantie, conferentie..."
              />
            </div>
          </div>
          <Button
            onClick={handleAddOverride}
            disabled={!overrideDate || addOverride.isPending}
            size="sm"
          >
            {addOverride.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-1.5" />
            )}
            Datum blokkeren
          </Button>

          {(data?.overrides?.length ?? 0) > 0 && (
            <div className="space-y-1.5 pt-3 border-t border-border">
              <p className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
                Geblokkeerde data
              </p>
              {data!.overrides
                .filter((o) => !o.available)
                .map((o) => (
                  <div
                    key={o.date}
                    className="flex items-center gap-2 rounded-md bg-zinc-50 dark:bg-zinc-900/40 px-2.5 py-1.5 text-xs"
                  >
                    <Badge variant="warning">{o.date}</Badge>
                    {o.reason && (
                      <span className="text-muted-foreground">— {o.reason}</span>
                    )}
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
