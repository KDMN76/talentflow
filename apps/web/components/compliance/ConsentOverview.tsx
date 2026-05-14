"use client";

import { useMemo, useState } from "react";
import {
  Search,
  MoreVertical,
  Link2,
  UserX,
  ShieldOff,
  Mail,
  ShieldCheck,
  Shield,
  Copy,
  CheckCircle2,
  Send,
  ShieldQuestion,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { useCandidates, useUpdateCandidate } from "@/hooks/useCandidates";
import {
  useAnonymizeCandidate,
  useExcludeFromRetention,
  useGenerateSelfServiceToken,
  useBulkConsentRequest,
} from "@/hooks/useCompliance";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils";
import type { Candidate } from "@/lib/mockData";

type ConsentStatus = "granted" | "pending" | "withdrawn" | "expired";

const CONSENT_FILTERS: Array<{ value: ConsentStatus | "all"; label: string }> = [
  { value: "all", label: "Alle statussen" },
  { value: "granted", label: "Verleend" },
  { value: "pending", label: "Pending" },
  { value: "withdrawn", label: "Ingetrokken" },
  { value: "expired", label: "Verlopen" },
];

function classifyConsent(c: Candidate): ConsentStatus {
  if (c.gdpr_consent && c.gdpr_consent_at) {
    // expired = older than 24 months
    const granted = new Date(c.gdpr_consent_at).getTime();
    const ageMonths =
      (Date.now() - granted) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths > 24) return "expired";
    return "granted";
  }
  if (!c.gdpr_consent && c.gdpr_consent_at) return "withdrawn";
  return "pending";
}

function ConsentBadge({ status, at }: { status: ConsentStatus; at?: string | null }) {
  const cfg: Record<
    ConsentStatus,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    granted: {
      label: "Verleend",
      className:
        "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900",
      icon: <ShieldCheck className="h-3 w-3" />,
    },
    pending: {
      label: "Pending",
      className:
        "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
      icon: <ShieldQuestion className="h-3 w-3" />,
    },
    withdrawn: {
      label: "Ingetrokken",
      className:
        "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
      icon: <ShieldOff className="h-3 w-3" />,
    },
    expired: {
      label: "Verlopen",
      className:
        "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
      icon: <Shield className="h-3 w-3" />,
    },
  };
  const { label, className, icon } = cfg[status];
  const tooltipText = at
    ? `Wijziging: ${new Date(at).toLocaleString("nl-NL")}`
    : "Geen registratie van wijziging";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              className
            )}
          >
            {icon}
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EmailConsentToggle({ candidate }: { candidate: Candidate }) {
  const updateCandidate = useUpdateCandidate();
  const { toast } = useToast();
  const checked = !!candidate.email_consent;

  const handleToggle = () => {
    updateCandidate.mutate(
      {
        id: candidate.id,
        email_consent: !checked,
        email_consent_at: !checked ? new Date().toISOString() : null,
      },
      {
        onSuccess: () => {
          toast({
            title: !checked ? "E-mail-toestemming verleend" : "Toestemming ingetrokken",
            description: candidate.name,
          });
        },
      }
    );
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      role="switch"
      aria-checked={checked}
      disabled={updateCandidate.isPending}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700",
        updateCandidate.isPending && "opacity-50"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

interface SelfPortalDialogProps {
  candidate: Candidate | null;
  url: string | null;
  onClose: () => void;
}

function SelfPortalDialog({ candidate, url, onClose }: SelfPortalDialogProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={!!candidate} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Self-portal link</DialogTitle>
          <DialogDescription>
            Deel deze link met{" "}
            <span className="font-medium">{candidate?.name}</span> zodat zij hun
            eigen gegevens kunnen inzien, bewerken of verwijderen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Beveiligde link</Label>
          <div className="flex items-center gap-2">
            <Input value={url ?? ""} readOnly className="font-mono text-xs" />
            <Button variant="outline" onClick={handleCopy}>
              {copied ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Token is 7 dagen geldig. Wordt gelogd in de audit-trail.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Sluiten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ExcludeRetentionDialogProps {
  candidate: Candidate | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

function ExcludeRetentionDialog({
  candidate,
  onClose,
  onConfirm,
}: ExcludeRetentionDialogProps) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={!!candidate} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Uitsluiten van retention</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{candidate?.name}</span> wordt
            uitgesloten van automatische verwijdering. Geef een grondige reden
            voor de audit-trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="exclude-reason">
            Reden <span className="text-destructive">*</span>
          </Label>
          <textarea
            id="exclude-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Bijv. lopende juridische procedure, contractbewaring, klantverplichting…"
            className="w-full min-h-[100px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            Uitsluiten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AnonymizeDialogProps {
  candidate: Candidate | null;
  onClose: () => void;
  onConfirm: () => void;
}

function AnonymizeDialog({ candidate, onClose, onConfirm }: AnonymizeDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  return (
    <Dialog open={!!candidate} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Anonimiseren — onomkeerbaar</DialogTitle>
          <DialogDescription>
            Alle persoonsgegevens van{" "}
            <span className="font-medium">{candidate?.name}</span> worden
            permanent verwijderd. Geanonimiseerde records worden bewaard voor
            statistiek en compliance, maar zijn niet langer naar een persoon
            herleidbaar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="anon-confirm">
            Typ <span className="font-mono font-bold">ANONIMISEER</span> ter
            bevestiging
          </Label>
          <Input
            id="anon-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="ANONIMISEER"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button
            variant="destructive"
            disabled={confirmText !== "ANONIMISEER"}
            onClick={() => {
              onConfirm();
              setConfirmText("");
            }}
          >
            Anonimiseren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConsentOverview() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConsentStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: candidates, isLoading } = useCandidates(search);
  const { toast } = useToast();

  const generateToken = useGenerateSelfServiceToken();
  const anonymize = useAnonymizeCandidate();
  const exclude = useExcludeFromRetention();
  const bulkConsent = useBulkConsentRequest();

  const [portalCandidate, setPortalCandidate] = useState<Candidate | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [excludeCandidate, setExcludeCandidate] = useState<Candidate | null>(null);
  const [anonCandidate, setAnonCandidate] = useState<Candidate | null>(null);

  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    if (filter === "all") return candidates;
    return candidates.filter((c) => classifyConsent(c) === filter);
  }, [candidates, filter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredCandidates.length) setSelected(new Set());
    else setSelected(new Set(filteredCandidates.map((c) => c.id)));
  };

  const handleSelfPortal = async (candidate: Candidate) => {
    const result = await generateToken.mutateAsync(candidate.id);
    setPortalCandidate(candidate);
    setPortalUrl(result.url);
  };

  const handleAnonymize = async () => {
    if (!anonCandidate) return;
    await anonymize.mutateAsync(anonCandidate.id);
    toast({
      title: "Kandidaat geanonimiseerd",
      description: anonCandidate.name,
    });
    setAnonCandidate(null);
  };

  const handleExclude = async (reason: string) => {
    if (!excludeCandidate) return;
    await exclude.mutateAsync({ candidateId: excludeCandidate.id, reason });
    toast({
      title: "Uitgesloten van retention",
      description: excludeCandidate.name,
    });
    setExcludeCandidate(null);
  };

  const handleBulkConsent = async (overrideIds?: string[]) => {
    const ids = overrideIds ?? Array.from(selected);
    if (ids.length === 0) return;
    const result = await bulkConsent.mutateAsync(ids);
    toast({
      title: "Consent-verzoeken verstuurd",
      description:
        result.sent === 1
          ? "1 kandidaat ontvangt een e-mail."
          : `${result.sent} kandidaten ontvangen een e-mail.`,
    });
    if (!overrideIds) setSelected(new Set());
  };

  return (
    <div className="space-y-4">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40 px-4 py-2.5">
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selected.size} geselecteerd
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Selectie wissen
            </Button>
            <Button
              size="sm"
              disabled={bulkConsent.isPending}
              onClick={() => handleBulkConsent()}
              className="gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              <Send className="h-3.5 w-3.5" />
              Stuur consent-request naar {selected.size} geselecteerde
            </Button>
          </div>
        </div>
      )}

      {/* Filter row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op naam, e-mail of skill…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CONSENT_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.value
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-muted-foreground dark:bg-zinc-900/40">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded accent-indigo-600"
                    checked={
                      filteredCandidates.length > 0 &&
                      selected.size === filteredCandidates.length
                    }
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-3 text-left font-semibold">Kandidaat</th>
                <th className="px-3 py-3 text-left font-semibold">GDPR</th>
                <th className="px-3 py-3 text-left font-semibold">E-mail</th>
                <th className="px-3 py-3 text-left font-semibold">
                  Laatste activiteit
                </th>
                <th className="w-10 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-3 py-3">
                      <Skeleton className="h-12 w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredCandidates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12">
                    <div className="flex flex-col items-center text-center">
                      <Shield className="h-10 w-10 text-zinc-300 mb-3" />
                      <p className="font-semibold">Geen kandidaten gevonden</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Pas je filters aan of voeg nieuwe kandidaten toe.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCandidates.map((c) => {
                  const status = classifyConsent(c);
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30"
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded accent-indigo-600"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
                              {getInitials(c.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">
                              {c.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {c.email ?? "–"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <ConsentBadge status={status} at={c.gdpr_consent_at} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <EmailConsentToggle candidate={c} />
                          <span className="text-xs text-muted-foreground">
                            {c.email_consent ? "Aan" : "Uit"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {new Date(c.updated_at).toLocaleDateString("nl-NL", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onClick={() => handleSelfPortal(c)}
                              className="gap-2"
                            >
                              <Link2 className="h-4 w-4" />
                              Self-portal link
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleBulkConsent([c.id])}
                              className="gap-2"
                            >
                              <Mail className="h-4 w-4" />
                              Stuur consent-request
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setExcludeCandidate(c)}
                              className="gap-2"
                            >
                              <ShieldOff className="h-4 w-4" />
                              Uitsluiten van retention
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setAnonCandidate(c)}
                              className="gap-2 text-destructive focus:text-destructive"
                            >
                              <UserX className="h-4 w-4" />
                              Anonimiseren
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SelfPortalDialog
        candidate={portalCandidate}
        url={portalUrl}
        onClose={() => {
          setPortalCandidate(null);
          setPortalUrl(null);
        }}
      />
      <ExcludeRetentionDialog
        candidate={excludeCandidate}
        onClose={() => setExcludeCandidate(null)}
        onConfirm={handleExclude}
      />
      <AnonymizeDialog
        candidate={anonCandidate}
        onClose={() => setAnonCandidate(null)}
        onConfirm={handleAnonymize}
      />
    </div>
  );
}

// Eslint: keep these used for callers (page.tsx) computing aggregate stats
export { classifyConsent, ConsentBadge };
export type { ConsentStatus };
