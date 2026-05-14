"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Clock,
  Download,
  FileText,
  Inbox,
  PlayCircle,
  Plus,
  Search,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useDsarRequests,
  useCreateDsarRequest,
  useUpdateDsarRequest,
  useFulfillDsarRequest,
  useDsarExportUrl,
  type DsarFilters,
  type DsarRequest,
  type DsarRequestType,
  type DsarStatus,
} from "@/hooks/useCompliance";
import { useCandidates } from "@/hooks/useCandidates";
import {
  DSAR_TYPE_LABELS,
  DSAR_STATUS_LABELS,
} from "@/lib/mockData";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<DsarRequestType, string> = {
  access:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
  export:
    "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900",
  correction:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  deletion:
    "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
};

const STATUS_COLOR: Record<DsarStatus, string> = {
  pending:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  fulfilled:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  rejected:
    "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

interface CountdownPill {
  label: string;
  className: string;
  icon: React.ReactNode;
}

function getCountdown(dueAt: string, status: DsarStatus): CountdownPill {
  if (status === "fulfilled" || status === "rejected") {
    return {
      label: "Afgerond",
      className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
      icon: <CheckCircle2 className="h-3 w-3" />,
    };
  }
  const ms = new Date(dueAt).getTime() - Date.now();
  const hours = Math.round(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (ms < 0) {
    const overdue = Math.abs(days);
    return {
      label: `${overdue} dgn over tijd`,
      className:
        "bg-red-200 text-red-800 dark:bg-red-950 dark:text-red-300 ring-1 ring-red-400",
      icon: <AlertCircle className="h-3 w-3" />,
    };
  }
  if (hours < 24) {
    return {
      label: `${hours} u tot deadline`,
      className:
        "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 ring-1 ring-red-200",
      icon: <AlertCircle className="h-3 w-3" />,
    };
  }
  if (days < 3) {
    return {
      label: `${days} dgn tot deadline`,
      className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
      icon: <AlertCircle className="h-3 w-3" />,
    };
  }
  if (days < 7) {
    return {
      label: `${days} dgn tot deadline`,
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
      icon: <Clock className="h-3 w-3" />,
    };
  }
  return {
    label: `${days} dgn tot deadline`,
    className:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    icon: <Clock className="h-3 w-3" />,
  };
}

// ─── Fulfill dialog ──────────────────────────────────────────────────────────

interface FulfillDialogProps {
  request: DsarRequest | null;
  onClose: () => void;
  onConfirm: (notes: string) => void;
  pending: boolean;
}

function FulfillDialog({ request, onClose, onConfirm, pending }: FulfillDialogProps) {
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>DSAR-verzoek vervullen</DialogTitle>
          <DialogDescription>
            Bevestig dat je dit verzoek hebt uitgevoerd. Voeg notities toe voor
            de audit-trail.
          </DialogDescription>
        </DialogHeader>
        {request && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">Type: </span>
              <span className="font-medium">
                {DSAR_TYPE_LABELS[request.request_type]}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Aanvrager: </span>
              <span className="font-medium">{request.requester_email}</span>
            </div>
            {request.candidate_name && (
              <div>
                <span className="text-muted-foreground">Kandidaat: </span>
                <span className="font-medium">{request.candidate_name}</span>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="fulfill-notes">
            Notities <span className="text-destructive">*</span>
          </Label>
          <textarea
            id="fulfill-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Bijv. export-bestand verstuurd via beveiligde link, 7 dagen geldig…"
            className="w-full min-h-[100px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Annuleren
          </Button>
          <Button
            disabled={!notes.trim() || pending}
            onClick={() => {
              onConfirm(notes.trim());
              setNotes("");
            }}
          >
            {pending ? "Vervullen…" : "Markeer als vervuld"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── New DSAR dialog ─────────────────────────────────────────────────────────

interface NewDsarDialogProps {
  open: boolean;
  onClose: () => void;
}

function NewDsarDialog({ open, onClose }: NewDsarDialogProps) {
  const { toast } = useToast();
  const create = useCreateDsarRequest();
  const { data: candidates } = useCandidates();

  const [candidateId, setCandidateId] = useState<string>("");
  const [requestType, setRequestType] = useState<DsarRequestType>("access");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");

  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    const q = search.toLowerCase();
    if (!q) return candidates.slice(0, 8);
    return candidates
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 8);
  }, [candidates, search]);

  const reset = () => {
    setCandidateId("");
    setRequestType("access");
    setEmail("");
    setNotes("");
    setSearch("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const candidate = candidates?.find((c) => c.id === candidateId);
    try {
      await create.mutateAsync({
        candidate_id: candidateId || null,
        candidate_name: candidate?.name ?? null,
        request_type: requestType,
        requester_email: email,
        notes: notes || null,
      });
      toast({
        title: "DSAR-verzoek aangemaakt",
        description: `Deadline: 30 dagen vanaf vandaag (AVG art. 12).`,
      });
      handleClose();
    } catch {
      toast({
        title: "Fout",
        description: "Kon het verzoek niet aanmaken.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nieuw DSAR-verzoek</DialogTitle>
          <DialogDescription>
            Registreer een verzoek tot inzage, export, correctie of verwijdering.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Kandidaat (optioneel)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek op naam of e-mail…"
                className="pl-9"
              />
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
              <button
                type="button"
                onClick={() => setCandidateId("")}
                className={cn(
                  "block w-full px-3 py-2 text-left text-xs",
                  candidateId === ""
                    ? "bg-indigo-50 dark:bg-indigo-950/40"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                )}
              >
                <span className="text-muted-foreground italic">
                  Geen kandidaat koppelen
                </span>
              </button>
              {filteredCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCandidateId(c.id);
                    if (c.email) setEmail(c.email);
                  }}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-xs border-t border-border",
                    candidateId === c.id
                      ? "bg-indigo-50 dark:bg-indigo-950/40"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  )}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-muted-foreground">{c.email}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Type verzoek</Label>
            <Select
              value={requestType}
              onValueChange={(v) => setRequestType(v as DsarRequestType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DSAR_TYPE_LABELS) as DsarRequestType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {DSAR_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dsar-email">
              E-mail aanvrager <span className="text-destructive">*</span>
            </Label>
            <Input
              id="dsar-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="aanvrager@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dsar-notes">Notities</Label>
            <textarea
              id="dsar-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Achtergrond of context van het verzoek…"
              className="w-full min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Annuleren
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!email.trim() || create.isPending}
          >
            {create.isPending ? "Aanmaken…" : "Verzoek aanmaken"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function DsarManagement() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<DsarFilters>({});
  const { data, isLoading } = useDsarRequests(filters);
  const update = useUpdateDsarRequest();
  const fulfill = useFulfillDsarRequest();
  const exportUrl = useDsarExportUrl();
  const [newOpen, setNewOpen] = useState(false);
  const [fulfillRequest, setFulfillRequest] = useState<DsarRequest | null>(null);

  const handleStart = (req: DsarRequest) => {
    update.mutate(
      { id: req.id, status: "in_progress" },
      {
        onSuccess: () => {
          toast({
            title: "Verzoek in behandeling",
            description: req.requester_email,
          });
        },
      }
    );
  };

  const handleFulfill = async (notes: string) => {
    if (!fulfillRequest) return;
    await fulfill.mutateAsync({ id: fulfillRequest.id, notes });
    toast({
      title: "DSAR vervuld",
      description: fulfillRequest.requester_email,
    });
    setFulfillRequest(null);
  };

  const handleDownload = async (req: DsarRequest) => {
    const result = await exportUrl.mutateAsync(req.id);
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      {/* Filter row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.status ?? "all"}
            onValueChange={(v) =>
              setFilters((f) => ({ ...f, status: v as DsarStatus | "all" }))
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Alle statussen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statussen</SelectItem>
              {(Object.keys(DSAR_STATUS_LABELS) as DsarStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {DSAR_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.request_type ?? "all"}
            onValueChange={(v) =>
              setFilters((f) => ({
                ...f,
                request_type: v as DsarRequestType | "all",
              }))
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Alle typen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle typen</SelectItem>
              {(Object.keys(DSAR_TYPE_LABELS) as DsarRequestType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {DSAR_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => setNewOpen(true)}
          className="gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          <Plus className="h-4 w-4" />
          Nieuw DSAR-verzoek
        </Button>
      </div>

      {/* List */}
      <div className="space-y-2.5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-3">
              <Inbox className="h-7 w-7 text-zinc-400" />
            </div>
            <p className="font-semibold">Geen DSAR-verzoeken</p>
            <p className="text-sm text-muted-foreground mt-1">
              Verzoeken van betrokkenen verschijnen hier zodra ze binnenkomen.
            </p>
          </div>
        ) : (
          data.map((req) => {
            const cd = getCountdown(req.due_at, req.status);
            return (
              <div
                key={req.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex flex-1 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <FileText className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          TYPE_COLOR[req.request_type]
                        )}
                      >
                        {DSAR_TYPE_LABELS[req.request_type]}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          STATUS_COLOR[req.status]
                        )}
                      >
                        {DSAR_STATUS_LABELS[req.status]}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          cd.className
                        )}
                      >
                        {cd.icon}
                        {cd.label}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {req.requester_email}
                    </p>
                    {req.candidate_name && (
                      <p className="text-xs text-muted-foreground">
                        Gekoppeld aan: {req.candidate_name}
                      </p>
                    )}
                    {req.notes && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {req.notes}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Aangemaakt:{" "}
                      {new Date(req.created_at).toLocaleDateString("nl-NL")} ·
                      Deadline:{" "}
                      {new Date(req.due_at).toLocaleDateString("nl-NL")}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:flex-nowrap">
                  {req.status === "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStart(req)}
                      className="gap-1.5"
                      disabled={update.isPending}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      In behandeling nemen
                    </Button>
                  )}
                  {(req.status === "pending" || req.status === "in_progress") && (
                    <Button
                      size="sm"
                      onClick={() => setFulfillRequest(req)}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 border-0"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Vervullen
                    </Button>
                  )}
                  {(req.request_type === "export" ||
                    req.request_type === "access") &&
                    req.status === "fulfilled" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(req)}
                        className="gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download export
                      </Button>
                    )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <FulfillDialog
        request={fulfillRequest}
        onClose={() => setFulfillRequest(null)}
        onConfirm={handleFulfill}
        pending={fulfill.isPending}
      />
      <NewDsarDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
