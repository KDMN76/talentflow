"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  RetentionPolicy,
  RetentionPolicyInput,
  DsarRequest,
  DsarRequestInput,
  DsarStatus,
  DsarRequestType,
  AuditEvent,
  AuditAction,
} from "@/lib/mockData";
import type {
  DEIFunnelReport,
  DEIFunnelSnapshot,
  DeiAlert,
  DeiBiasLevel,
  DeiFunnelStage,
  PayBucket,
  PayEquityReport,
  PayEquitySnapshot,
  PayTransparencyReport,
  TenantPaySettings,
} from "@/lib/types/skills";

// ─── Types re-exported for callers ──────────────────────────────────────────

export type {
  RetentionPolicy,
  RetentionPolicyInput,
  DsarRequest,
  DsarRequestInput,
  DsarStatus,
  DsarRequestType,
  AuditEvent,
  AuditAction,
};

export interface DsarFilters {
  status?: DsarStatus | "all";
  request_type?: DsarRequestType | "all";
  from?: string;
  to?: string;
}

export interface AuditFilters {
  entity_type?: string;
  action?: AuditAction | "all";
  user_id?: string;
  search?: string;
  from?: string;
  to?: string;
}

// ─── Retention policies ──────────────────────────────────────────────────────

export function useRetentionPolicies() {
  return useQuery({
    queryKey: ["compliance", "retention-policies"],
    queryFn: async (): Promise<RetentionPolicy[]> => {
      const { data } = await api.get<{ data: RetentionPolicy[] }>(
        "/compliance/retention-policies"
      );
      return data.data;
    },
  });
}

export function useCreateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RetentionPolicyInput): Promise<RetentionPolicy> => {
      const { data } = await api.post<RetentionPolicy>(
        "/compliance/retention-policies",
        input
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["compliance", "retention-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useUpdateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<RetentionPolicyInput> & { id: string }): Promise<RetentionPolicy> => {
      const { data } = await api.patch<RetentionPolicy>(
        `/compliance/retention-policies/${id}`,
        patch
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["compliance", "retention-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useDeleteRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/compliance/retention-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["compliance", "retention-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function usePreviewRetentionPolicy() {
  return useMutation({
    mutationFn: async (
      id: string
    ): Promise<{ affected_count: number; sample_names: string[] }> => {
      const { data } = await api.get<{
        affected_count: number;
        sample_names: string[];
      }>(`/compliance/retention-policies/${id}/preview`);
      return data;
    },
  });
}

// ─── DSAR requests ───────────────────────────────────────────────────────────

export function useDsarRequests(filters: DsarFilters = {}) {
  return useQuery({
    queryKey: ["compliance", "dsar-requests", filters],
    queryFn: async (): Promise<DsarRequest[]> => {
      const { data } = await api.get<{ data: DsarRequest[] }>(
        "/compliance/dsar-requests",
        { params: filters }
      );
      return data.data;
    },
  });
}

export function useCreateDsarRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DsarRequestInput): Promise<DsarRequest> => {
      const { data } = await api.post<DsarRequest>(
        "/compliance/dsar-requests",
        input
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "dsar-requests"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useUpdateDsarRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<DsarRequest> & { id: string }): Promise<DsarRequest> => {
      const { data } = await api.patch<DsarRequest>(
        `/compliance/dsar-requests/${id}`,
        patch
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "dsar-requests"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useFulfillDsarRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      notes,
    }: {
      id: string;
      notes?: string;
    }): Promise<DsarRequest> => {
      const { data } = await api.patch<DsarRequest>(
        `/compliance/dsar-requests/${id}`,
        { status: "fulfilled", notes }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "dsar-requests"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export interface DataExportLink {
  url: string;
  expires_at: string;
}

/**
 * AVG art. 15 — maak een kort-levende download-link (24u, max 3 downloads)
 * voor het dossier van de kandidaat achter een DSAR-verzoek. De link wijst
 * naar de publieke /api/gdpr-export/:token endpoint en kan dus ook veilig
 * per e-mail aan de betrokkene worden doorgestuurd.
 */
export function useDsarExportUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<DataExportLink> => {
      const { data } = await api.post<{ data: DataExportLink }>(
        `/compliance/dsar-requests/${id}/export-link`
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

// ─── Candidate-level GDPR actions ────────────────────────────────────────────

export function useAnonymizeCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (candidateId: string): Promise<{ ok: true }> => {
      await api.post(`/candidates/${candidateId}/anonymize`);
      return { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

/**
 * AVG art. 15 — export-link direct vanaf kandidaat-detail (zonder DSAR).
 * Zelfde token-mechaniek als useDsarExportUrl.
 */
export function useCandidateExportLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (candidateId: string): Promise<DataExportLink> => {
      const { data } = await api.post<{ data: DataExportLink }>(
        `/candidates/${candidateId}/export-link`
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useGenerateSelfServiceToken() {
  return useMutation({
    mutationFn: async (
      candidateId: string
    ): Promise<{ token: string; url: string }> => {
      const { data } = await api.post<{ token: string; url: string }>(
        `/candidates/${candidateId}/self-service-token`
      );
      return data;
    },
  });
}

export function useExcludeFromRetention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      reason,
    }: {
      candidateId: string;
      reason: string;
    }): Promise<{ ok: true }> => {
      await api.post(`/candidates/${candidateId}/retention-exclude`, { reason });
      return { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useBulkConsentRequest() {
  return useMutation({
    mutationFn: async (
      candidateIds: string[]
    ): Promise<{ sent: number }> => {
      const { data } = await api.post<{ sent: number }>(
        "/compliance/bulk-consent-request",
        { candidate_ids: candidateIds }
      );
      return data;
    },
  });
}

// ─── Audit-trail ─────────────────────────────────────────────────────────────

/**
 * De audit-API levert `created_at` / `user_name` / `user_email` /
 * `related_entity_name`, terwijl de UI `timestamp` / `actor_name` /
 * `actor_email` verwacht en het object-label wil tonen. Normaliseer defensief
 * en tolereer beide contract-vormen.
 */
function normalizeAuditEvent(raw: unknown): AuditEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const asRecord = (v: unknown) =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  return {
    id: (r.id as string) ?? "",
    timestamp:
      (r.timestamp as string) ??
      (r.occurred_at as string) ??
      (r.created_at as string) ??
      "",
    action: ((r.action as string) ?? "unknown") as AuditAction,
    entity_type: (r.entity_type as string) ?? "",
    entity_id: (r.entity_id as string) ?? "",
    related_entity_name:
      (r.related_entity_name as string) ?? null,
    actor_name:
      (r.actor_name as string) ?? (r.user_name as string) ?? null,
    actor_email:
      (r.actor_email as string) ?? (r.user_email as string) ?? null,
    ip_address: (r.ip_address as string) ?? null,
    before: asRecord(r.before),
    after: asRecord(r.after),
  };
}

export function useAuditEvents(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: ["compliance", "audit-events", filters],
    queryFn: async (): Promise<AuditEvent[]> => {
      const { data } = await api.get<unknown>("/compliance/audit-events", {
        params: filters,
      });
      const arr = unwrap(data);
      return (Array.isArray(arr) ? arr : []).map(normalizeAuditEvent);
    },
  });
}

// ─── Pay Transparency settings ───────────────────────────────────────────────

export type {
  TenantPaySettings,
  PayEquityReport,
  PayEquitySnapshot,
  PayTransparencyReport,
  DEIFunnelReport,
  DEIFunnelSnapshot,
};

export function usePaySettings() {
  return useQuery({
    queryKey: ["compliance", "pay-settings"],
    queryFn: async (): Promise<TenantPaySettings> => {
      // API wrapt in { data } — dubbel `data` is dus géén typo.
      const { data } = await api.get<{ data: TenantPaySettings }>(
        "/compliance/pay-settings"
      );
      return data.data;
    },
  });
}

export function useUpdatePaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<TenantPaySettings>
    ): Promise<TenantPaySettings> => {
      const { data } = await api.patch<{ data: TenantPaySettings }>(
        "/compliance/pay-settings",
        patch
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "pay-settings"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "pay-transparency-report"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

/**
 * Pay-transparency rapport (EU 2023/970 art. 5): % open vacatures met
 * volledige salarisband + actielijst van vacatures zonder band.
 */
export function usePayTransparencyReport() {
  return useQuery({
    queryKey: ["compliance", "pay-transparency-report"],
    queryFn: async (): Promise<PayTransparencyReport> => {
      const { data } = await api.get<{ data: PayTransparencyReport }>(
        "/compliance/pay-transparency-report"
      );
      return data.data;
    },
  });
}

// ─── Normalisatie API ↔ frontend (contract-drift, defensief) ────────────────
//
// De compliance-API (payEquity.service / deiFunnel.service) levert:
//   * demografische breakdowns als `Record<string, …>` i.p.v. arrays;
//   * `period_start` / `period_end` i.p.v. `from` / `to`;
//   * `total_offers` i.p.v. `total_records`, `bias_indicator` i.p.v. `bias_score`;
//   * severity 'low'|'medium'|'high' i.p.v. 'info'|'warning'|'critical';
//   * en wrapt het rapport in `{ data: … }`.
// De componenten verwachten de rijkere frontend-shape (`PayBucket[]`,
// `breakdown`, `bias_level`, …). We normaliseren hier zodat de UI nooit crasht
// op een afwijkende of lege response, óók bij tenants zonder data.

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Pakt `{ data: X }` uit, of geeft de waarde ongewijzigd terug. */
function unwrap(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).data;
  }
  return raw;
}

const GENDER_LABELS_NL: Record<string, string> = {
  male: "Man",
  female: "Vrouw",
  other: "Non-binair",
  prefer_not: "Niet opgegeven",
  unknown: "Onbekend",
};

const NATIONALITY_LABELS_NL: Record<string, string> = {
  NL: "Nederlands",
  "EU-other": "EU (overig)",
  "non-EU": "Buiten EU",
  unknown: "Onbekend",
};

function prettyKey(key: string): string {
  if (!key) return "Onbekend";
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

function labelFor(key: string, labels?: Record<string, string>): string {
  return labels?.[key] ?? prettyKey(key);
}

/** `Record<string, {count, median}>` → `PayBucket[]` (pay-equity detail). */
function bucketsFromStats(
  rec: unknown,
  labels?: Record<string, string>
): PayBucket[] {
  if (!rec || typeof rec !== "object") return [];
  return Object.entries(rec as Record<string, unknown>).map(([key, value]) => {
    const stats = (value ?? {}) as { count?: unknown; median?: unknown };
    const hasMedian =
      typeof stats.median === "number" ||
      (typeof stats.median === "string" && stats.median.trim() !== "");
    return {
      group_label: labelFor(key, labels),
      count: num(stats.count),
      median_salary: hasMedian ? num(stats.median) : null,
      suppressed: false,
    };
  });
}

type DeiBreakdownRow = DeiFunnelStage["breakdown"]["gender"][number];

/** `Record<string, number>` → DEI-breakdown-rijen (per stage). */
function bucketsFromCounts(
  rec: unknown,
  total: number,
  labels?: Record<string, string>
): DeiBreakdownRow[] {
  if (!rec || typeof rec !== "object") return [];
  return Object.entries(rec as Record<string, unknown>).map(([key, value]) => {
    const count = num(value);
    return {
      label: labelFor(key, labels),
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      suppressed: false,
    };
  });
}

function normalizePayEquityReport(raw: unknown): PayEquityReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const gap = num(r.pay_gap_pct);
  return {
    tenant_id: typeof r.tenant_id === "string" ? r.tenant_id : "",
    from: (r.from as string) ?? (r.period_start as string) ?? "",
    to: (r.to as string) ?? (r.period_end as string) ?? "",
    job_category: (r.job_category as string) ?? null,
    total_records: num(r.total_records ?? r.total_offers),
    pay_gap_pct: gap,
    // De backend berekent (nog) geen regressie-gecorrigeerde gap; toon de
    // ongecorrigeerde waarde als proxy i.p.v. `undefined.toFixed()` te crashen.
    adjusted_pay_gap_pct: num(r.adjusted_pay_gap_pct, gap),
    by_gender: bucketsFromStats(r.by_gender, GENDER_LABELS_NL),
    by_age_bracket: bucketsFromStats(r.by_age_bracket),
    by_nationality: bucketsFromStats(
      r.by_nationality ?? r.by_nationality_bucket,
      NATIONALITY_LABELS_NL
    ),
    k_anonymity_threshold: num(r.k_anonymity_threshold, 5),
    computed_at: (r.computed_at as string) ?? new Date().toISOString(),
  };
}

function normalizePayEquitySnapshot(
  raw: unknown,
  idx: number
): PayEquitySnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const from = (r.from as string) ?? (r.period_start as string) ?? "";
  const to = (r.to as string) ?? (r.period_end as string) ?? "";
  const computed = (r.computed_at as string) ?? "";
  return {
    id: (r.id as string) ?? `${from}_${to}_${computed || idx}`,
    from,
    to,
    pay_gap_pct: num(r.pay_gap_pct),
    computed_at: computed,
  };
}

function biasLevelFromScore(score: number): DeiBiasLevel {
  if (score > 25) return "high";
  if (score > 15) return "medium";
  return "low";
}

function normalizeDeiStage(raw: unknown): DeiFunnelStage {
  const s = (raw ?? {}) as Record<string, unknown>;
  const total = num(s.total);
  const bias = num(s.bias_score ?? s.bias_indicator);
  return {
    stage_id:
      (s.stage_id as string) ??
      `${num(s.stage_position)}::${(s.stage_name as string) ?? ""}`,
    stage_name: (s.stage_name as string) ?? "—",
    total,
    conversion_pct: null,
    bias_score: bias,
    bias_level: biasLevelFromScore(bias),
    breakdown: {
      gender: bucketsFromCounts(s.by_gender, total, GENDER_LABELS_NL),
      age_bracket: bucketsFromCounts(s.by_age_bracket, total),
      nationality: bucketsFromCounts(
        s.by_nationality_bucket ?? s.by_nationality,
        total,
        NATIONALITY_LABELS_NL
      ),
    },
  };
}

function normalizeDeiAlert(raw: unknown, stages: DeiFunnelStage[]): DeiAlert {
  const a = (raw ?? {}) as Record<string, unknown>;
  const stageName = (a.stage_name as string) ?? "";
  const sev = a.severity;
  const severity: DeiAlert["severity"] =
    sev === "high" || sev === "critical"
      ? "critical"
      : sev === "medium" || sev === "warning"
        ? "warning"
        : "info";
  return {
    stage_id: stages.find((s) => s.stage_name === stageName)?.stage_id ?? "",
    stage_name: stageName,
    message: (a.message as string) ?? "",
    severity,
  };
}

function normalizeDeiFunnelReport(raw: unknown): DEIFunnelReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const stages = Array.isArray(r.stages)
    ? (r.stages as unknown[]).map(normalizeDeiStage)
    : [];
  const alerts = Array.isArray(r.alerts)
    ? (r.alerts as unknown[]).map((a) => normalizeDeiAlert(a, stages))
    : [];
  return {
    tenant_id: typeof r.tenant_id === "string" ? r.tenant_id : "",
    from: (r.from as string) ?? (r.period_start as string) ?? "",
    to: (r.to as string) ?? (r.period_end as string) ?? "",
    stages,
    alerts,
    k_anonymity_threshold: num(r.k_anonymity_threshold, 5),
    computed_at: (r.computed_at as string) ?? new Date().toISOString(),
  };
}

/**
 * De snapshots-API levert één rij per stage; de UI toont één regel per
 * periode. We dedupliceren op (from, to). `total_alerts` staat niet in de
 * per-stage-rijen, dus valt terug op 0 (getoond, niet berekend).
 */
function normalizeDeiSnapshots(raw: unknown): DEIFunnelSnapshot[] {
  const rows = Array.isArray(raw) ? raw : [];
  const byPeriod = new Map<string, DEIFunnelSnapshot>();
  rows.forEach((row, idx) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const from = (r.from as string) ?? (r.period_start as string) ?? "";
    const to = (r.to as string) ?? (r.period_end as string) ?? "";
    const key = `${from}_${to}`;
    if (!byPeriod.has(key)) {
      byPeriod.set(key, {
        id: (r.id as string) ?? key ?? String(idx),
        from,
        to,
        total_alerts: num(r.total_alerts),
        computed_at: (r.computed_at as string) ?? "",
      });
    }
  });
  return Array.from(byPeriod.values());
}

// ─── Pay Equity report ──────────────────────────────────────────────────────

export interface PayEquityFilters {
  from: string;
  to: string;
  job_category?: string | null;
}

export function usePayEquityReport(filters: PayEquityFilters | null) {
  return useQuery({
    queryKey: ["compliance", "pay-equity", filters],
    enabled: !!filters,
    queryFn: async (): Promise<PayEquityReport> => {
      const { data } = await api.post<unknown>(
        "/compliance/pay-equity",
        filters
      );
      return normalizePayEquityReport(unwrap(data));
    },
  });
}

export function usePayEquitySnapshots() {
  return useQuery({
    queryKey: ["compliance", "pay-equity-snapshots"],
    queryFn: async (): Promise<PayEquitySnapshot[]> => {
      const { data } = await api.get<unknown>(
        "/compliance/pay-equity/snapshots"
      );
      const arr = unwrap(data);
      return (Array.isArray(arr) ? arr : []).map(normalizePayEquitySnapshot);
    },
  });
}

// ─── DEI funnel ─────────────────────────────────────────────────────────────

export interface DEIFunnelFilters {
  from: string;
  to: string;
}

export function useDeiFunnelReport(filters: DEIFunnelFilters | null) {
  return useQuery({
    queryKey: ["compliance", "dei-funnel", filters],
    enabled: !!filters,
    queryFn: async (): Promise<DEIFunnelReport> => {
      const { data } = await api.post<unknown>(
        "/compliance/dei-funnel",
        filters
      );
      return normalizeDeiFunnelReport(unwrap(data));
    },
  });
}

export function useDeiFunnelSnapshots() {
  return useQuery({
    queryKey: ["compliance", "dei-funnel-snapshots"],
    queryFn: async (): Promise<DEIFunnelSnapshot[]> => {
      const { data } = await api.get<unknown>(
        "/compliance/dei-funnel/snapshots"
      );
      return normalizeDeiSnapshots(unwrap(data));
    },
  });
}
