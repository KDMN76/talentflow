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
import { useCandidates } from "@/hooks/useCandidates";
import { useOrganizations, type Organization } from "@/hooks/useCrm";
import type { ContractType } from "@/lib/types/backOffice";
import type { Candidate } from "@talentflow/shared";

export default function NewContractPage() {
  const { t } = useTranslation("contracts");
  const router = useRouter();
  const { toast } = useToast();
  const createContract = useCreateContract();

  const [candidateName, setCandidateName] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateMenuOpen, setCandidateMenuOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientOrgId, setClientOrgId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [contractType, setContractType] = useState<ContractType>("contract");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("40");
  const [rateCandidate, setRateCandidate] = useState("");
  const [rateClient, setRateClient] = useState("");
  const [cao, setCao] = useState("");

  // Search-selects: candidates come from the API filtered by query; client
  // organizations are filtered client-side from the (typically small) CRM list.
  const candidatesQuery = useCandidates(candidateQuery || undefined);
  const organizationsQuery = useOrganizations();
  const filteredOrganizations = useMemo(() => {
    const list = organizationsQuery.data ?? [];
    const q = clientQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((org) => org.name.toLowerCase().includes(q));
  }, [organizationsQuery.data, clientQuery]);

  const margin = useMemo(() => {
    const c = parseFloat(rateCandidate);
    const k = parseFloat(rateClient);
    if (!c || !k || k <= 0) return null;
    return Math.round(((k - c) / k) * 1000) / 10;
  }, [rateCandidate, rateClient]);

  // Backend requires real UUIDs for candidate_id/client_organization_id — both
  // must come from an actual selection, never free-typed or defaulted.
  const canSubmit =
    !!candidateId &&
    !!clientOrgId &&
    startDate &&
    weeklyHours &&
    rateCandidate &&
    rateClient;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const created = await createContract.mutateAsync({
        candidate_id: candidateId,
        candidate_name: candidateName,
        client_organization_id: clientOrgId,
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
                  <SearchSelect<Candidate>
                    query={candidateQuery}
                    onQueryChange={(v) => {
                      setCandidateQuery(v);
                      setCandidateId("");
                      setCandidateName(v);
                    }}
                    open={candidateMenuOpen}
                    onOpenChange={setCandidateMenuOpen}
                    options={candidatesQuery.data ?? []}
                    isLoading={candidatesQuery.isLoading}
                    getOptionId={(c) => c.id}
                    getOptionLabel={(c) => c.name}
                    getOptionSublabel={(c) => c.email}
                    onSelect={(c) => {
                      setCandidateId(c.id);
                      setCandidateName(c.name);
                      setCandidateQuery(c.name);
                      setCandidateMenuOpen(false);
                    }}
                    placeholder={t("new.fields.candidatePlaceholder")}
                    noResultsText={t("new.fields.candidateNoResults")}
                    selected={!!candidateId}
                  />
                </Field>
                <Field label={t("new.fields.client")}>
                  <SearchSelect<Organization>
                    query={clientQuery}
                    onQueryChange={(v) => {
                      setClientQuery(v);
                      setClientOrgId("");
                      setClientName(v);
                    }}
                    open={clientMenuOpen}
                    onOpenChange={setClientMenuOpen}
                    options={filteredOrganizations}
                    isLoading={organizationsQuery.isLoading}
                    getOptionId={(o) => o.id}
                    getOptionLabel={(o) => o.name}
                    getOptionSublabel={(o) => o.industry}
                    onSelect={(o) => {
                      setClientOrgId(o.id);
                      setClientName(o.name);
                      setClientQuery(o.name);
                      setClientMenuOpen(false);
                    }}
                    placeholder={t("new.fields.clientPlaceholder")}
                    noResultsText={t("new.fields.clientNoResults")}
                    selected={!!clientOrgId}
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

/**
 * Minimal search-select combobox: types into an Input, filters `options`
 * (server- or client-filtered by the caller), and picks one via a dropdown
 * list. Used to force candidate/client selection onto real UUIDs instead of
 * free-typed IDs (see contracts/new bugfix — placeholder IDs broke
 * `createContractSchema`'s `.uuid()` validation on the backend).
 */
function SearchSelect<T>({
  query,
  onQueryChange,
  open,
  onOpenChange,
  options,
  isLoading,
  getOptionId,
  getOptionLabel,
  getOptionSublabel,
  onSelect,
  placeholder,
  noResultsText,
  selected,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: T[];
  isLoading?: boolean;
  getOptionId: (option: T) => string;
  getOptionLabel: (option: T) => string;
  getOptionSublabel?: (option: T) => string | null | undefined;
  onSelect: (option: T) => void;
  placeholder?: string;
  noResultsText?: string;
  selected: boolean;
}) {
  return (
    <div
      className="relative"
      onBlur={(e) => {
        // Close only when focus leaves the whole combobox (not when it moves
        // from the input to an item inside the list).
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          onOpenChange(false);
        }
      }}
    >
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => onOpenChange(true)}
        placeholder={placeholder}
        className={selected ? "border-emerald-400 dark:border-emerald-600" : undefined}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {isLoading ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
            </div>
          ) : options.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              {noResultsText}
            </div>
          ) : (
            options.map((option) => {
              const id = getOptionId(option);
              const sublabel = getOptionSublabel?.(option);
              return (
                <button
                  key={id}
                  type="button"
                  onMouseDown={(e) => {
                    // mousedown fires before the input's blur, so selection
                    // survives without a race against onBlur closing the menu.
                    e.preventDefault();
                    onSelect(option);
                  }}
                  className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent"
                >
                  <span className="font-medium">{getOptionLabel(option)}</span>
                  {sublabel && (
                    <span className="text-xs text-muted-foreground">{sublabel}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
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
