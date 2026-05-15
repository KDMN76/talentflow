"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Mic,
  Monitor,
  Phone,
  Users,
  Video,
  MapPin,
  FileText,
  Sparkles,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useAvailableSlots,
  useScheduleInterview,
} from "@/hooks/useInterviews";
import { useInterviewKits } from "@/hooks/useInterviewKits";
import { useTenantUsers, type TenantUser } from "@/hooks/useUsers";
import { cn, getInitials } from "@/lib/utils";
import type {
  AvailableSlot,
  InterviewLocationType,
} from "@/lib/types/interviews";

type DurationOption = 30 | 45 | 60 | 90;
type Step = 1 | 2 | 3 | 4 | 5 | 6;

const LOCATION_OPTIONS: Array<{
  value: InterviewLocationType;
  label: string;
  description: string;
  icon: typeof Video;
  generatesLink: boolean;
}> = [
  {
    value: "google_meet",
    label: "Google Meet",
    description: "Auto-gegenereerde Meet-link",
    icon: Video,
    generatesLink: true,
  },
  {
    value: "teams",
    label: "Microsoft Teams",
    description: "Auto-gegenereerde Teams-link",
    icon: Monitor,
    generatesLink: true,
  },
  {
    value: "zoom",
    label: "Zoom",
    description: "Auto-gegenereerde Zoom-link",
    icon: Video,
    generatesLink: true,
  },
  {
    value: "in_person",
    label: "In persoon",
    description: "Op locatie — adres invullen",
    icon: MapPin,
    generatesLink: false,
  },
  {
    value: "phone",
    label: "Telefonisch",
    description: "Telefoonnummer in plaats van link",
    icon: Phone,
    generatesLink: false,
  },
];

const STEP_LABELS: Record<Step, string> = {
  1: "Kandidaat & vacature",
  2: "Interviewers",
  3: "Tijdstip",
  4: "Locatie",
  5: "Interview kit",
  6: "Bevestigen",
};

export interface SchedulerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, step 1 is auto-completed and skipped. */
  applicationId?: string;
  /** Required when `applicationId` is provided — used to hydrate step 1. */
  candidateId?: string;
  candidateName?: string;
  jobId?: string;
  jobTitle?: string;
}

interface SchedulerState {
  step: Step;
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  job_id: string;
  job_title: string;
  interviewer_ids: string[];
  duration_minutes: DurationOption;
  selected_slot: AvailableSlot | null;
  location_type: InterviewLocationType;
  location_url: string;
  location_address: string;
  kit_id: string | null;
  notes: string;
}

const INITIAL_STATE: SchedulerState = {
  step: 1,
  application_id: "",
  candidate_id: "",
  candidate_name: "",
  job_id: "",
  job_title: "",
  interviewer_ids: [],
  duration_minutes: 60,
  selected_slot: null,
  location_type: "google_meet",
  location_url: "",
  location_address: "",
  kit_id: null,
  notes: "",
};

export function SchedulerDialog({
  open,
  onOpenChange,
  applicationId,
  candidateId,
  candidateName,
  jobId,
  jobTitle,
}: SchedulerDialogProps) {
  const { toast } = useToast();
  const schedule = useScheduleInterview();
  const [state, setState] = useState<SchedulerState>(INITIAL_STATE);

  // Reset state when the dialog opens. When `applicationId` is supplied,
  // hydrate from the props passed by the caller and skip directly to step 2.
  useEffect(() => {
    if (!open) return;
    if (applicationId) {
      setState({
        ...INITIAL_STATE,
        step: 2,
        application_id: applicationId,
        candidate_id: candidateId ?? "",
        candidate_name: candidateName ?? "",
        job_id: jobId ?? "",
        job_title: jobTitle ?? "",
      });
    } else {
      setState(INITIAL_STATE);
    }
  }, [open, applicationId, candidateId, candidateName, jobId, jobTitle]);

  const update = (patch: Partial<SchedulerState>) =>
    setState((s) => ({ ...s, ...patch }));

  const stepsToShow: Step[] = applicationId ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6];

  const nextStep = () => {
    const idx = stepsToShow.indexOf(state.step);
    if (idx < stepsToShow.length - 1) update({ step: stepsToShow[idx + 1] });
  };
  const prevStep = () => {
    const idx = stepsToShow.indexOf(state.step);
    if (idx > 0) update({ step: stepsToShow[idx - 1] });
  };

  const canAdvance = (() => {
    switch (state.step) {
      case 1:
        return !!state.application_id;
      case 2:
        return state.interviewer_ids.length > 0;
      case 3:
        return !!state.selected_slot;
      case 4: {
        const opt = LOCATION_OPTIONS.find(
          (o) => o.value === state.location_type
        );
        if (!opt) return false;
        if (opt.generatesLink) return true; // link auto-generated server-side
        if (state.location_type === "in_person")
          return state.location_address.trim().length > 0;
        if (state.location_type === "phone")
          return state.location_address.trim().length > 0;
        return true;
      }
      case 5:
        return true; // kit is optional
      case 6:
        return true;
    }
  })();

  const handleSubmit = async () => {
    if (!state.selected_slot) return;
    try {
      await schedule.mutateAsync({
        application_id: state.application_id,
        candidate_id: state.candidate_id,
        job_id: state.job_id,
        scheduled_start: state.selected_slot.start,
        duration_minutes: state.duration_minutes,
        timezone: "Europe/Amsterdam",
        interviewer_ids: state.interviewer_ids,
        location_type: state.location_type,
        location_url: state.location_url || null,
        location_address: state.location_address || null,
        kit_id: state.kit_id,
        notes: state.notes.trim() || null,
      });
      toast({
        title: "Interview ingepland",
        description: `${state.candidate_name} — ${formatSlot(state.selected_slot)}`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Inplannen mislukt",
        description: e instanceof Error ? e.message : "Onbekende fout",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-indigo-500" />
            Nieuw interview inplannen
          </DialogTitle>
          <DialogDescription>
            Stap {stepsToShow.indexOf(state.step) + 1} van {stepsToShow.length}{" "}
            — {STEP_LABELS[state.step]}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <Stepper steps={stepsToShow} current={state.step} />

        <div className="py-4">
          {state.step === 1 && <Step1Selection />}

          {state.step === 2 && (
            <Step2Interviewers
              selectedIds={state.interviewer_ids}
              onChange={(ids) => update({ interviewer_ids: ids })}
            />
          )}

          {state.step === 3 && (
            <Step3Slot
              interviewerIds={state.interviewer_ids}
              duration={state.duration_minutes}
              selected={state.selected_slot}
              onDurationChange={(d) =>
                update({ duration_minutes: d, selected_slot: null })
              }
              onSelect={(slot) => update({ selected_slot: slot })}
            />
          )}

          {state.step === 4 && (
            <Step4Location
              type={state.location_type}
              url={state.location_url}
              address={state.location_address}
              onTypeChange={(t) => update({ location_type: t })}
              onUrlChange={(u) => update({ location_url: u })}
              onAddressChange={(a) => update({ location_address: a })}
            />
          )}

          {state.step === 5 && (
            <Step5Kit
              jobId={state.job_id}
              selectedKitId={state.kit_id}
              onSelect={(id) => update({ kit_id: id })}
              notes={state.notes}
              onNotesChange={(n) => update({ notes: n })}
            />
          )}

          {state.step === 6 && <Step6Confirm state={state} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button
            variant="ghost"
            onClick={prevStep}
            disabled={state.step === stepsToShow[0]}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Vorige
          </Button>
          {state.step === 6 ? (
            <Button
              onClick={handleSubmit}
              disabled={schedule.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {schedule.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Plan in
            </Button>
          ) : (
            <Button
              onClick={nextStep}
              disabled={!canAdvance}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Volgende <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stepper indicator ──────────────────────────────────────────────────────

function Stepper({ steps, current }: { steps: Step[]; current: Step }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
      {steps.map((s, idx) => {
        const active = s === current;
        const done = steps.indexOf(current) > idx;
        return (
          <div key={s} className="flex items-center gap-1.5 shrink-0">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
                active &&
                  "bg-indigo-600 text-white shadow-sm",
                !active && done &&
                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                !active && !done &&
                  "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              )}
            >
              {done && <Check className="h-3 w-3" />}
              {idx + 1}. {STEP_LABELS[s]}
            </div>
            {idx < steps.length - 1 && (
              <span className="h-px w-3 bg-zinc-200 dark:bg-zinc-700" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Application select ─────────────────────────────────────────────

/**
 * Free application picker (when no `applicationId` is provided up-front).
 *
 * TODO: backend must expose a "list applications across all jobs for the
 * current tenant" endpoint before this picker can be wired up. Until then,
 * callers should always open the dialog with `applicationId` + the related
 * candidate/job props pre-filled. See `SchedulerDialogProps`.
 */
function Step1Selection() {
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">
        Kies de sollicitatie waarvoor je een interview wilt inplannen.
      </p>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Open de planner vanaf de pipeline of het sollicitatie-detail. Direct
        zoeken over alle sollicitaties is nog niet beschikbaar.
      </div>
    </div>
  );
}

// ─── Step 2: Interviewers multi-select ─────────────────────────────────────

function Step2Interviewers({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: tenantUsers, isLoading } = useTenantUsers();
  const users: TenantUser[] = tenantUsers ?? [];
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">
        Selecteer één of meerdere interviewers. We tonen alleen tijdstippen
        waarop iedereen beschikbaar is.
      </p>
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Teamleden laden…
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Geen teamleden gevonden.
          </div>
        ) : (
          users.map((m) => {
          const selected = selectedIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              className={cn(
                "flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-all",
                selected
                  ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-indigo-300"
                  : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              )}
            >
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
                  {getInitials(m.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{m.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {m.email} · {m.role}
                </p>
              </div>
              <div
                className={cn(
                  "h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0",
                  selected
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "border-zinc-300 dark:border-zinc-600"
                )}
              >
                {selected && <Check className="h-3 w-3" />}
              </div>
            </button>
          );
        })
        )}
      </div>
      {selectedIds.length > 0 && (
        <div className="mt-3 text-xs text-muted-foreground">
          <Users className="inline h-3 w-3 mr-1" />
          {selectedIds.length}{" "}
          {selectedIds.length === 1 ? "interviewer" : "interviewers"} geselecteerd
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Slot calendar grid ─────────────────────────────────────────────

const DURATIONS: DurationOption[] = [30, 45, 60, 90];

function Step3Slot({
  interviewerIds,
  duration,
  selected,
  onDurationChange,
  onSelect,
}: {
  interviewerIds: string[];
  duration: DurationOption;
  selected: AvailableSlot | null;
  onDurationChange: (d: DurationOption) => void;
  onSelect: (s: AvailableSlot) => void;
}) {
  // 14-day window starting today.
  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 14 * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const slots = useAvailableSlots({
    interviewer_ids: interviewerIds,
    from: range.from,
    to: range.to,
    duration_minutes: duration,
  });

  // Group slots by date string (YYYY-MM-DD).
  const grouped = useMemo(() => {
    const map = new Map<string, AvailableSlot[]>();
    (slots.data ?? []).forEach((s) => {
      const day = new Date(s.start).toISOString().slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(s);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots.data]);

  return (
    <div className="space-y-4">
      {/* Duration toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground mr-2">
          Duur
        </Label>
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDurationChange(d)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-semibold transition-all",
              duration === d
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "border-border bg-background hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            )}
          >
            {d} min
          </button>
        ))}
      </div>

      {/* Calendar grid */}
      {slots.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Beschikbaarheid laden…
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Geen tijden beschikbaar waarop alle interviewers vrij zijn in de
          komende 14 dagen. Probeer een kortere duur of minder interviewers.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
          {grouped.map(([day, daySlots]) => (
            <div
              key={day}
              className="rounded-lg border border-border p-3 bg-background"
            >
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  {formatDay(day)}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {daySlots.map((s) => {
                  const isSel = selected?.start === s.start;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => onSelect(s)}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-xs font-semibold transition-all",
                        isSel
                          ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                          : "border-border hover:border-indigo-300 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20"
                      )}
                    >
                      {formatTime(s.start)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-900/40 p-3 flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-indigo-500" />
          <span className="font-semibold text-indigo-700 dark:text-indigo-300">
            {formatSlot(selected)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Location ──────────────────────────────────────────────────────

function Step4Location({
  type,
  url,
  address,
  onTypeChange,
  onUrlChange,
  onAddressChange,
}: {
  type: InterviewLocationType;
  url: string;
  address: string;
  onTypeChange: (t: InterviewLocationType) => void;
  onUrlChange: (u: string) => void;
  onAddressChange: (a: string) => void;
}) {
  const opt = LOCATION_OPTIONS.find((o) => o.value === type);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {LOCATION_OPTIONS.map((o) => {
          const Icon = o.icon;
          const sel = type === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onTypeChange(o.value)}
              className={cn(
                "rounded-lg border p-3 text-left transition-all flex items-start gap-3",
                sel
                  ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-indigo-300"
                  : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              )}
            >
              <div
                className={cn(
                  "rounded-md h-9 w-9 flex items-center justify-center shrink-0",
                  sel
                    ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{o.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  {o.description}
                </p>
              </div>
              {sel && <Check className="h-4 w-4 text-indigo-600 ml-auto shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Conditional inputs */}
      {opt?.generatesLink ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/40 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
          <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Een {opt.label}-link wordt automatisch gegenereerd zodra het
            interview is opgeslagen. Of vul hieronder een handmatige URL in als
            je een bestaande link wilt hergebruiken.
          </span>
        </div>
      ) : null}

      {opt?.generatesLink && (
        <div className="space-y-1.5">
          <Label htmlFor="loc-url">Handmatige URL (optioneel)</Label>
          <Input
            id="loc-url"
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
          />
        </div>
      )}

      {type === "in_person" && (
        <div className="space-y-1.5">
          <Label htmlFor="loc-addr">Locatie / adres</Label>
          <Input
            id="loc-addr"
            type="text"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Spaklerweg 79, Amsterdam — Vergaderzaal Mondriaan"
          />
        </div>
      )}

      {type === "phone" && (
        <div className="space-y-1.5">
          <Label htmlFor="loc-phone">Telefoonnummer</Label>
          <Input
            id="loc-phone"
            type="tel"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="+31 20 123 4567"
          />
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Kit + notes ───────────────────────────────────────────────────

function Step5Kit({
  jobId,
  selectedKitId,
  onSelect,
  notes,
  onNotesChange,
}: {
  jobId: string;
  selectedKitId: string | null;
  onSelect: (id: string | null) => void;
  notes: string;
  onNotesChange: (n: string) => void;
}) {
  const kits = useInterviewKits(jobId || undefined);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          Kies een interview-kit om gestandaardiseerde vragen te gebruiken
          tijdens het gesprek. Kits worden automatisch gekoppeld aan een
          scorecard-template.
        </p>
        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              "flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-all",
              selectedKitId === null
                ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-indigo-300"
                : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
            )}
          >
            <div className="rounded-md bg-zinc-100 dark:bg-zinc-800 h-9 w-9 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Geen kit</p>
              <p className="text-[11px] text-muted-foreground">
                Vrij gesprek zonder voorgedefinieerde vragen.
              </p>
            </div>
            {selectedKitId === null && (
              <Check className="h-4 w-4 text-indigo-600 shrink-0" />
            )}
          </button>
          {(kits.data ?? []).map((kit) => {
            const sel = selectedKitId === kit.id;
            return (
              <button
                key={kit.id}
                type="button"
                onClick={() => onSelect(kit.id)}
                className={cn(
                  "flex items-start gap-3 w-full rounded-lg border p-3 text-left transition-all",
                  sel
                    ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-indigo-300"
                    : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                )}
              >
                <div className="rounded-md bg-purple-100 dark:bg-purple-950/40 h-9 w-9 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-purple-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{kit.name}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    {kit.description ?? "Geen beschrijving"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {kit.questions.length} vragen
                    {kit.scorecard_template_name &&
                      ` · ${kit.scorecard_template_name}`}
                  </p>
                </div>
                {sel && (
                  <Check className="h-4 w-4 text-indigo-600 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="iv-notes">Notities (optioneel)</Label>
        <textarea
          id="iv-notes"
          rows={3}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Achtergrond voor de interviewers, focuspunten, recente CV-aanpassingen..."
          className="flex min-h-[72px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
        />
      </div>
    </div>
  );
}

// ─── Step 6: Confirm ────────────────────────────────────────────────────────

function Step6Confirm({ state }: { state: SchedulerState }) {
  const { data: tenantUsers } = useTenantUsers();
  const interviewers = (tenantUsers ?? []).filter((m) =>
    state.interviewer_ids.includes(m.id)
  );
  const locOpt = LOCATION_OPTIONS.find((o) => o.value === state.location_type);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Controleer de details. Klik op "Plan in" om uitnodigingen te versturen.
      </p>
      <div className="rounded-lg border border-border divide-y divide-border bg-background">
        <ConfirmRow
          icon={<Users className="h-4 w-4 text-indigo-500" />}
          label="Kandidaat"
          value={`${state.candidate_name} — ${state.job_title}`}
        />
        <ConfirmRow
          icon={<Users className="h-4 w-4 text-emerald-500" />}
          label="Interviewers"
          value={interviewers.map((m) => m.name).join(", ") || "—"}
        />
        <ConfirmRow
          icon={<Clock className="h-4 w-4 text-amber-500" />}
          label="Tijdstip"
          value={
            state.selected_slot
              ? formatSlot(state.selected_slot, state.duration_minutes)
              : "—"
          }
        />
        <ConfirmRow
          icon={
            locOpt ? (
              <locOpt.icon className="h-4 w-4 text-purple-500" />
            ) : (
              <MapPin className="h-4 w-4 text-purple-500" />
            )
          }
          label="Locatie"
          value={
            locOpt
              ? `${locOpt.label}${
                  state.location_url
                    ? ` — ${state.location_url}`
                    : state.location_address
                      ? ` — ${state.location_address}`
                      : locOpt.generatesLink
                        ? " (link wordt gegenereerd)"
                        : ""
                }`
              : "—"
          }
        />
        <ConfirmRow
          icon={<FileText className="h-4 w-4 text-rose-500" />}
          label="Interview kit"
          value={
            state.kit_id
              ? `Kit ${state.kit_id}`
              : "Geen kit"
          }
        />
        {state.notes && (
          <ConfirmRow
            icon={<Mic className="h-4 w-4 text-blue-500" />}
            label="Notities"
            value={state.notes}
          />
        )}
      </div>
    </div>
  );
}

function ConfirmRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
          {label}
        </p>
        <p className="text-sm text-zinc-800 dark:text-zinc-200 mt-0.5 break-words">
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDay(day: string): string {
  const d = new Date(day);
  return d.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSlot(s: AvailableSlot, durationOverride?: number): string {
  const start = new Date(s.start);
  const dur = durationOverride ?? s.duration_minutes;
  const end = new Date(start.getTime() + dur * 60_000);
  return `${start.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })} · ${start.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  })}–${end.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
