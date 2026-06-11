"use client";

/**
 * Sprint Q4.4 — Nieuw contract.
 *
 * Recruiter vult kandidaat, klant, type, datums en tarieven in. Marge wordt
 * live berekend. Bij submit komt het contract als status='draft' in de lijst.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileSignature, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useCreateContract } from "@/hooks/useBackOffice";
import type { ContractType } from "@/lib/types/backOffice";

export default function NewContractPage() {
  const { t } = useTranslation("contracts");
  const router = useRouter();
  const { toast } = useToast();
  const createContract = useCreateContract();

  const [candidateName, setCandidateName] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientOrgId, setClientOrgId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [contractType, setContractType] = useState<ContractType>("contract");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("40");
  const [rateCandidate, setRateCandidate] = useState("");
  const [rateClient, setRateClient] = useState("");
  const [cao, setCao] = useState("");

  const margin = useMemo(() => {
    const c = parseFloat(rateCandidate);
    const k = parseFloat(rateClient);
    if (!c || !k || k <= 0) return null;
    return Math.round(((k - c) / k) * 1000) / 10;
  }, [rateCandidate, rateClient]);

  const canSubmit =
    candidateName.trim() &&
    clientName.trim() &&
    startDate &&
    weeklyHours &&
    rateCandidate &&
    rateClient;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const created = await createContract.mutateAsync({
        candidate_id: candidateId || `cand-new-${Date.now()}`,
        candidate_name: candidateName,
        client_organization_id: clientOrgId || `org-new-${Date.now()}`,
        client_name: clientName,
        job_id: null,
        contract_type: contractType,
        start_date: startDate,
        end_date: endDate || null,
        weekly_hours: parseFloat(weeklyHours),
        hourly_rate_candidate: parseFloat(rateCandidate),
        hourly_rate_client: parseFloat(rateClient),
        cao: cao || null,
      });
      toast({
        title: t("new.toasts.created.title"),
        description: t("new.toasts.created.description", {
          candidate: candidateName,
          client: clientName,
        }),
      });
      router.push(`/contracts/${created.id}`);
    } catch {
      toast({ title: t("new.toasts.createError.title"), variant: "destructive" });
    }
    // job_title is collected for UI display only; hooks signature doesn't pass it.
    // (jobTitle var preserved to avoid TypeScript unused-warning during edits.)
    void jobTitle;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link href="/contracts">
        <Button variant="ghost" size="sm" className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("new.back")}
        </Button>
      </Link>

      <PageHeader
        title={t("new.title")}
        description={t("new.description")}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-6 p-6">
            {/* Section: parties */}
            <Section title={t("new.sections.parties")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("new.fields.candidate")}>
                  <Input
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    placeholder={t("new.fields.candidatePlaceholder")}
                  />
                </Field>
                <Field label={t("new.fields.candidateId")}>
                  <Input
                    value={candidateId}
                    onChange={(e) => setCandidateId(e.target.value)}
                    placeholder={t("new.fields.candidateIdPlaceholder")}
                  />
                </Field>
                <Field label={t("new.fields.client")}>
                  <Input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder={t("new.fields.clientPlaceholder")}
                  />
                </Field>
                <Field label={t("new.fields.clientOrgId")}>
                  <Input
                    value={clientOrgId}
                    onChange={(e) => setClientOrgId(e.target.value)}
                    placeholder={t("new.fields.clientOrgIdPlaceholder")}
                  />
                </Field>
                <Field label={t("new.fields.jobTitle")}>
                  <Input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder={t("new.fields.jobTitlePlaceholder")}
                  />
                </Field>
                <Field label={t("new.fields.type")}>
                  <Select
                    value={contractType}
                    onValueChange={(v) => setContractType(v as ContractType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contract">{t("type.contract")}</SelectItem>
                      <SelectItem value="temp">{t("type.temp")}</SelectItem>
                      <SelectItem value="freelance">{t("type.freelance")}</SelectItem>
                      <SelectItem value="permanent">{t("type.permanent")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </Section>

            <Section title={t("new.sections.period")}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("new.fields.startDate")}>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                <Field label={t("new.fields.endDate")}>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </Field>
                <Field label={t("new.fields.weeklyHours")}>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    step={0.5}
                    value={weeklyHours}
                    onChange={(e) => setWeeklyHours(e.target.value)}
                  />
                </Field>
              </div>
            </Section>

            <Section title={t("new.sections.rates")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("new.fields.rateCandidate")}>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={rateCandidate}
                    onChange={(e) => setRateCandidate(e.target.value)}
                    placeholder="75.00"
                  />
                </Field>
                <Field label={t("new.fields.rateClient")}>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={rateClient}
                    onChange={(e) => setRateClient(e.target.value)}
                    placeholder="110.00"
                  />
                </Field>
              </div>
            </Section>

            <Section title={t("new.sections.compliance")}>
              <Field label={t("new.fields.cao")}>
                <Input
                  value={cao}
                  onChange={(e) => setCao(e.target.value)}
                  placeholder={t("new.fields.caoPlaceholder")}
                />
              </Field>
            </Section>
          </CardContent>
        </Card>

        {/* Sidebar summary */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-indigo-500" />
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Samenvatting
                </p>
              </div>
              <dl className="space-y-2 text-sm">
                <SummaryRow
                  label="Marge per uur"
                  value={
                    rateCandidate && rateClient
                      ? `€ ${(parseFloat(rateClient) - parseFloat(rateCandidate)).toFixed(2)}`
                      : "—"
                  }
                />
                <SummaryRow
                  label="Marge %"
                  value={margin != null ? `${margin.toFixed(1)}%` : "—"}
                  accent={
                    margin != null && margin >= 30
                      ? "emerald"
                      : margin != null && margin >= 20
                      ? "amber"
                      : margin != null
                      ? "red"
                      : undefined
                  }
                />
                <SummaryRow
                  label="Marge per week"
                  value={
                    weeklyHours && rateCandidate && rateClient
                      ? `€ ${(
                          parseFloat(weeklyHours) *
                          (parseFloat(rateClient) - parseFloat(rateCandidate))
                        ).toFixed(2)}`
                      : "—"
                  }
                />
              </dl>
              <p className="mt-4 text-[11px] text-muted-foreground">
                Indicatief — exclusief BTW, sociale lasten, en
                CAO-verplichtingen.
              </p>
            </CardContent>
          </Card>

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || createContract.isPending}
            className="w-full border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
            size="lg"
          >
            {createContract.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSignature className="mr-1.5 h-4 w-4" />
            )}
            Contract aanmaken
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "amber" | "red";
}) {
  const cls = accent
    ? accent === "emerald"
      ? "text-emerald-600 dark:text-emerald-400 font-semibold"
      : accent === "amber"
      ? "text-amber-600 dark:text-amber-400 font-semibold"
      : "text-red-600 dark:text-red-400 font-semibold"
    : "text-zinc-900 dark:text-zinc-100 font-medium";
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm tabular-nums ${cls}`}>{value}</dd>
    </div>
  );
}
