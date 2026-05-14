"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useBulkCampaigns,
  useCreateBulkCampaign,
  type BulkCampaign,
  type BulkCampaignInput,
} from "@/hooks/useBulkCampaigns";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useMailboxIntegrations } from "@/hooks/useMailboxIntegrations";
import type { BulkCampaignAudience } from "@/lib/mockData";

/**
 * Three-step wizard for creating a bulk-mail campaign.
 *
 * Step 1 — basics: name, subject, body (or pick template)
 * Step 2 — audience: status / source / tags filter (consent always enforced)
 * Step 3 — sending channel: Resend (transactional) or mailbox integration
 */

type Step = 1 | 2 | 3;

const STATUS_OPTIONS: { value: NonNullable<BulkCampaignAudience["status"]>[number]; label: string }[] = [
  { value: "active", label: "Actief" },
  { value: "inactive", label: "Inactief" },
  { value: "hired", label: "Aangenomen" },
  { value: "rejected", label: "Afgewezen" },
];

export interface CampaignBuilderProps {
  onClose: () => void;
  onCreated: (campaign: BulkCampaign) => void;
}

export function CampaignBuilder({ onClose, onCreated }: CampaignBuilderProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [statusSel, setStatusSel] = useState<string[]>(["active"]);
  const [tagsCsv, setTagsCsv] = useState("");
  const [provider, setProvider] = useState<BulkCampaignInput["provider"]>("resend");
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: templates } = useEmailTemplates();
  const { data: mailboxes } = useMailboxIntegrations();
  const create = useCreateBulkCampaign();
  const { data: existing } = useBulkCampaigns();

  const tags = useMemo(
    () =>
      tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsCsv]
  );

  const audience: BulkCampaignAudience = useMemo(
    () => ({
      status: statusSel as NonNullable<BulkCampaignAudience["status"]>,
      tags: tags.length ? tags : undefined,
      has_email_consent: true,
    }),
    [statusSel, tags]
  );

  function applyTemplate(id: string) {
    const t = templates?.find((tpl) => tpl.id === id);
    if (!t) return;
    setTemplateId(id);
    setSubject(t.subject);
    setBodyHtml(t.body_html ?? "");
  }

  function toggleStatus(value: string) {
    setStatusSel((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function validateStep(s: Step): string | null {
    if (s === 1) {
      if (!name.trim()) return "Geef de campagne een naam.";
      if (!subject.trim()) return "Onderwerp is verplicht.";
      if (!bodyHtml.trim()) return "Bericht-inhoud is verplicht.";
    }
    if (s === 2) {
      if (statusSel.length === 0) return "Kies minstens één status.";
    }
    if (s === 3) {
      if (provider !== "resend" && !mailboxId) {
        return "Kies een gekoppelde mailbox voor deze provider.";
      }
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((step + 1) as Step);
  }

  function back() {
    setError(null);
    setStep((step - 1) as Step);
  }

  async function submit() {
    const err = validateStep(3);
    if (err) {
      setError(err);
      return;
    }
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        subject: subject.trim(),
        body_html: bodyHtml,
        template_id: templateId,
        provider,
        mailbox_integration_id: provider === "resend" ? null : mailboxId,
        audience,
      });
      onCreated(created);
    } catch (e) {
      setError((e as Error).message ?? "Aanmaken mislukt.");
    }
  }

  const connectedMailboxes = (mailboxes ?? []).filter(
    (m) => m.active && (provider === "resend" || m.provider === provider)
  );

  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
            <Mail className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Nieuwe bulk-mailcampagne
            </h2>
            <p className="text-xs text-muted-foreground">
              Stap {step} van 3 — {step === 1 ? "Inhoud" : step === 2 ? "Doelgroep" : "Verzendkanaal"}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-indigo-500" : "bg-zinc-200 dark:bg-zinc-800"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="px-6 py-5 space-y-4 min-h-[360px]">
        {step === 1 && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="camp-name">Naam (intern)</Label>
              <Input
                id="camp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bv. Reactivatie Q2 — frontend developers"
              />
            </div>

            {(templates?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <Label>Template (optioneel)</Label>
                <Select
                  value={templateId ?? "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") {
                      setTemplateId(null);
                    } else {
                      applyTemplate(v);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Geen template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Geen template</SelectItem>
                    {templates!.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="camp-subject">Onderwerp</Label>
              <Input
                id="camp-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Bv. Nieuwe rol — past dit nog bij je?"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-body">Bericht (HTML toegestaan)</Label>
              <Textarea
                id="camp-body"
                rows={8}
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                placeholder="Hi {{first_name}},&#10;&#10;..."
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Ondersteunde merge-vars: <code>{"{{first_name}}"}</code>,{" "}
                <code>{"{{last_name}}"}</code>, <code>{"{{job_title}}"}</code>.
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20 p-3 flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-xs text-emerald-800 dark:text-emerald-300">
                Server-side wordt voor elke kandidaat gecheckt of e-mail-consent
                is gegeven (AVG-conform). Kandidaten zonder consent worden automatisch
                overgeslagen.
              </div>
            </div>

            <div className="space-y-2">
              <Label>Kandidaat-status</Label>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((opt) => {
                  const checked = statusSel.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleStatus(opt.value)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
                        checked
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                          : "border-border hover:border-zinc-300 dark:hover:border-zinc-700"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-indigo-500 bg-indigo-500 text-white"
                            : "border-zinc-300 dark:border-zinc-700"
                        }`}
                      >
                        {checked && <CheckCircle2 className="h-3 w-3" />}
                      </span>
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-tags">Tags (komma-gescheiden, optioneel)</Label>
              <Input
                id="camp-tags"
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="senior, react, amsterdam"
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[11px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border p-3 flex items-center gap-2.5">
              <Users className="h-4 w-4 text-indigo-500" />
              <div className="text-xs text-muted-foreground">
                Geschat bereik: tussen 50 en 150 kandidaten — exact aantal bekend
                na consent-check.
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="space-y-2">
              <Label>Verzendkanaal</Label>
              <div className="grid grid-cols-1 gap-2">
                {(["resend", "gmail", "outlook"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setProvider(p);
                      setMailboxId(null);
                    }}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                      provider === p
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                        : "border-border hover:border-zinc-300 dark:hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium capitalize">
                        {p === "resend" ? "Resend (transactioneel)" : p}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {p === "resend"
                          ? "Hoogvolume — verzonden vanaf het tenant-domein."
                          : `Persoonlijke mailbox — verstuurd vanaf je gekoppelde ${p}-account.`}
                      </div>
                    </div>
                    {provider === p && (
                      <CheckCircle2 className="h-4 w-4 text-indigo-500" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {provider !== "resend" && (
              <div className="space-y-1.5">
                <Label>Gekoppelde mailbox</Label>
                {connectedMailboxes.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-amber-800 dark:text-amber-300">
                      Geen gekoppelde {provider}-mailbox gevonden. Koppel er
                      eerst één in <strong>Instellingen → Integraties</strong>.
                    </div>
                  </div>
                ) : (
                  <Select
                    value={mailboxId ?? ""}
                    onValueChange={(v) => setMailboxId(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Kies mailbox..." />
                    </SelectTrigger>
                    <SelectContent>
                      {connectedMailboxes.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.account_email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border p-4 space-y-2">
              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Samenvatting
              </div>
              <dl className="grid grid-cols-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Naam</dt>
                <dd className="col-span-2 truncate">{name || "—"}</dd>
                <dt className="text-muted-foreground">Onderwerp</dt>
                <dd className="col-span-2 truncate">{subject || "—"}</dd>
                <dt className="text-muted-foreground">Status-filter</dt>
                <dd className="col-span-2">
                  {statusSel.length ? statusSel.join(", ") : "—"}
                </dd>
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="col-span-2 capitalize">{provider}</dd>
              </dl>
              {(existing?.length ?? 0) > 0 && (
                <p className="text-[11px] text-muted-foreground pt-1">
                  Tip: {existing!.length} eerdere campagne(s) zijn beschikbaar als
                  referentie.
                </p>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="border-t border-border px-6 py-4 flex items-center justify-between gap-2 bg-zinc-50/50 dark:bg-zinc-900/30">
        <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
          Annuleren
        </Button>
        <div className="flex items-center gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={back} disabled={create.isPending}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Vorige
            </Button>
          )}
          {step < 3 && (
            <Button onClick={next}>
              Volgende
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={submit}
              disabled={create.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Aanmaken...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1.5" />
                  Campagne starten
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
