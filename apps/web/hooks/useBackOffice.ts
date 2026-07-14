"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { unwrapData, unwrapList } from "@/lib/apiEnvelope";
import type {
  AccountingCatalogEntry,
  AccountingIntegration,
  AccountingProvider,
  CommissionAssignment,
  CommissionRecord,
  CommissionRecordStatus,
  CommissionScheme,
  CommissionSchemeType,
  Contract,
  ContractExtension,
  ContractStatus,
  ContractType,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  MarginGroupBy,
  MarginRow,
  RevenueForecastMonth,
  Timesheet,
  TimesheetEntry,
  TimesheetStatus,
  TimesheetSummary,
} from "@/lib/types/backOffice";

/**
 * Sprint Q4.4 — React-Query hooks for the temp/contract back-office.
 *
 * Backend contract:
 *   /api/contracts                       — Agent TTT
 *   /api/timesheets                      — Agent TTT
 *   /api/public/timesheets/:token        — Agent TTT (kandidaat-portaal)
 *   /api/invoices                        — Agent UUU
 *   /api/accounting/...                  — Agent UUU
 *   /api/commissions/...                 — Agent UUU
 *   /api/forecasting/...                 — Agent UUU
 */

// Re-export types so callers can import from one place.
export type {
  AccountingCatalogEntry,
  AccountingIntegration,
  AccountingProvider,
  CommissionAssignment,
  CommissionRecord,
  CommissionRecordStatus,
  CommissionScheme,
  CommissionSchemeType,
  Contract,
  ContractExtension,
  ContractStatus,
  ContractType,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  MarginGroupBy,
  MarginRow,
  RevenueForecastMonth,
  Timesheet,
  TimesheetEntry,
  TimesheetStatus,
  TimesheetSummary,
} from "@/lib/types/backOffice";

// ─── Contracts ───────────────────────────────────────────────────────────────

export interface ContractFilters {
  status?: ContractStatus;
  candidate_id?: string;
  job_id?: string;
  cursor?: string;
  limit?: number;
}

export function useContracts(filters: ContractFilters = {}) {
  return useQuery({
    queryKey: ["contracts", filters],
    queryFn: async (): Promise<Contract[]> => {
      // Backend levert { data: [...], next_cursor } (niet { items }). unwrapList
      // tolereert { data } / { items } / bare array en valt terug op [] zodat
      // `.reduce`/`.filter` in consumers nooit op een niet-array draait.
      const { data } = await api.get<unknown>("/contracts", { params: filters });
      return unwrapList<Contract>(data);
    },
  });
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: ["contracts", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<Contract> => {
      if (!id) throw new Error("Geen contract-ID");
      // Backend levert { data: contract } → uitpakken (anders leest de detail-
      // pagina velden op de wrapper → "niet gevonden"/crash).
      const { data } = await api.get<unknown>(`/contracts/${id}`);
      return unwrapData<Contract>(data);
    },
  });
}

export function useContractExtensions(contractId: string | undefined) {
  return useQuery({
    queryKey: ["contracts", contractId ?? "none", "extensions"],
    enabled: !!contractId,
    queryFn: async (): Promise<ContractExtension[]> => {
      if (!contractId) return [];
      // TODO: de route GET /contracts/:id/extensions BESTAAT NIET (404) — wordt
      // in een aparte backend-workstream toegevoegd. Bewust niet aangeraakt in
      // de envelope-fix; envelope/unwrap volgt zodra de route er is.
      const { data } = await api.get<ContractExtension[]>(
        `/contracts/${contractId}/extensions`
      );
      return data;
    },
  });
}

export interface CreateContractInput {
  candidate_id: string;
  candidate_name?: string;
  client_organization_id: string | null;
  client_name?: string;
  job_id: string | null;
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  weekly_hours: number | null;
  hourly_rate_candidate: number | null;
  hourly_rate_client: number | null;
  cao: string | null;
  currency?: string;
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateContractInput): Promise<Contract> => {
      // Backend levert { data: contract } → uitpakken (consument leest `.id`
      // voor de redirect naar /contracts/:id).
      const { data } = await api.post<unknown>("/contracts", input);
      return unwrapData<Contract>(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
    },
  });
}

export function useUpdateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Contract>;
    }): Promise<Contract> => {
      const { data } = await api.patch<Contract>(`/contracts/${id}`, patch);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
    },
  });
}

export interface ExtendContractInput {
  id: string;
  new_end_date: string;
  reason: string;
}

export function useExtendContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      new_end_date,
      reason,
    }: ExtendContractInput): Promise<Contract> => {
      const { data } = await api.post<Contract>(`/contracts/${id}/extend`, {
        new_end_date,
        reason,
      });
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({
        queryKey: ["contracts", vars.id, "extensions"],
      });
    },
  });
}

export interface TerminateContractInput {
  id: string;
  reason: string;
  effective_date?: string;
}

export function useTerminateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
      effective_date,
    }: TerminateContractInput): Promise<Contract> => {
      const { data } = await api.post<Contract>(
        `/contracts/${id}/terminate`,
        { reason, effective_date }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts"] });
    },
  });
}

// ─── Timesheets ──────────────────────────────────────────────────────────────

export interface TimesheetFilters {
  contract_id?: string;
  status?: TimesheetStatus;
  week_start?: string;
  cursor?: string;
}

export function useTimesheets(filters: TimesheetFilters = {}) {
  return useQuery({
    queryKey: ["timesheets", filters],
    queryFn: async (): Promise<Timesheet[]> => {
      // Backend levert { data: [...], next_cursor } — NIET { items }. De oude
      // `.items`-lezing gaf undefined → lege lijst. unwrapList pakt { data }.
      const { data } = await api.get<unknown>("/timesheets", { params: filters });
      return unwrapList<Timesheet>(data);
    },
  });
}

export function useTimesheet(id: string | undefined) {
  return useQuery({
    queryKey: ["timesheets", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<Timesheet> => {
      if (!id) throw new Error("Geen timesheet-ID");
      // Backend levert { data: timesheet } → uitpakken.
      const { data } = await api.get<unknown>(`/timesheets/${id}`);
      return unwrapData<Timesheet>(data);
    },
  });
}

export function useCreateTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contract_id,
      week_start,
    }: {
      contract_id: string;
      week_start: string;
    }): Promise<Timesheet> => {
      const { data } = await api.post<Timesheet>("/timesheets", {
        contract_id,
        week_start,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
  });
}

export interface UpsertEntryInput {
  timesheetId: string;
  entryId?: string;
  date: string;
  hours: number;
  overtime_hours?: number;
  break_minutes?: number;
  description?: string | null;
  project_code?: string | null;
}

export function useAddEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<UpsertEntryInput, "entryId">
    ): Promise<TimesheetEntry> => {
      const { data } = await api.post<TimesheetEntry>(
        `/timesheets/${input.timesheetId}/entries`,
        {
          date: input.date,
          hours: input.hours,
          overtime_hours: input.overtime_hours ?? 0,
          break_minutes: input.break_minutes ?? 0,
          description: input.description ?? null,
          project_code: input.project_code ?? null,
        }
      );
      return data;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      qc.invalidateQueries({ queryKey: ["timesheets", v.timesheetId] });
    },
  });
}

export function useUpdateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: UpsertEntryInput & { entryId: string }
    ): Promise<TimesheetEntry> => {
      const { data } = await api.patch<TimesheetEntry>(
        `/timesheets/${input.timesheetId}/entries/${input.entryId}`,
        {
          date: input.date,
          hours: input.hours,
          overtime_hours: input.overtime_hours ?? 0,
          break_minutes: input.break_minutes ?? 0,
          description: input.description ?? null,
          project_code: input.project_code ?? null,
        }
      );
      return data;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      qc.invalidateQueries({ queryKey: ["timesheets", v.timesheetId] });
    },
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      timesheetId,
      entryId,
    }: {
      timesheetId: string;
      entryId: string;
    }): Promise<void> => {
      await api.delete(`/timesheets/${timesheetId}/entries/${entryId}`);
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      qc.invalidateQueries({ queryKey: ["timesheets", v.timesheetId] });
    },
  });
}

export function useSubmitTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Timesheet> => {
      const { data } = await api.post<Timesheet>(`/timesheets/${id}/submit`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
  });
}

export function useApproveTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Timesheet> => {
      const { data } = await api.post<Timesheet>(`/timesheets/${id}/approve`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
  });
}

export function useRejectTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }): Promise<Timesheet> => {
      const { data } = await api.post<Timesheet>(
        `/timesheets/${id}/reject`,
        { reason }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
  });
}

export function useDisputeTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }): Promise<Timesheet> => {
      const { data } = await api.post<Timesheet>(
        `/timesheets/${id}/dispute`,
        { reason }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
  });
}

export function useTimesheetSummary(
  contractId: string | undefined,
  periodStart: string | undefined,
  periodEnd: string | undefined
) {
  return useQuery({
    queryKey: [
      "timesheets",
      "summary",
      contractId ?? "none",
      periodStart ?? "",
      periodEnd ?? "",
    ],
    enabled: !!contractId,
    queryFn: async (): Promise<TimesheetSummary> => {
      if (!contractId) throw new Error("Geen contract");
      // Backend levert { data: summary } → uitpakken.
      const { data } = await api.get<unknown>("/timesheets/summary", {
        params: {
          contract_id: contractId,
          period_start: periodStart,
          period_end: periodEnd,
        },
      });
      return unwrapData<TimesheetSummary>(data);
    },
  });
}

// ─── Public timesheet portaal (token-based) ─────────────────────────────────

export interface PublicTimesheetData {
  contract_id: string;
  candidate_id: string;
  timesheet: Timesheet;
  token_expires_at: string;
  /**
   * NB: GET /public/timesheets/:token levert (nog) GEEN contract-object — de
   * portaalpagina leest contract.candidate_name/client_name/weekly_hours.
   * Optioneel gehouden zodat de page compileert én met optional-chaining niet
   * crasht; het daadwerkelijk meesturen van deze velden hoort in een aparte
   * backend/page-workstream, niet in deze envelope-fix.
   */
  contract?: Pick<
    Contract,
    | "id"
    | "candidate_name"
    | "client_name"
    | "weekly_hours"
    | "hourly_rate_candidate"
    | "currency"
  >;
}

export function usePublicTimesheet(token: string | undefined) {
  return useQuery({
    queryKey: ["public-timesheet", token ?? "none"],
    enabled: !!token,
    queryFn: async (): Promise<PublicTimesheetData> => {
      if (!token) throw new Error("Geen token");
      // Backend levert { data: { contract_id, candidate_id, timesheet,
      // token_expires_at } } → uitpakken (anders krijgt de page de wrapper en
      // is data.timesheet undefined → leeg formulier).
      const { data } = await api.get<unknown>(`/public/timesheets/${token}`);
      return unwrapData<PublicTimesheetData>(data);
    },
  });
}

export function useSavePublicEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
      entryId,
      ...rest
    }: {
      token: string;
      timesheetId: string;
      entryId?: string;
      date: string;
      hours: number;
      overtime_hours?: number;
      break_minutes?: number;
      description?: string | null;
      project_code?: string | null;
    }): Promise<TimesheetEntry> => {
      const { data } = await api.post<TimesheetEntry>(
        `/public/timesheets/${token}/entries`,
        { entry_id: entryId, ...rest }
      );
      return data;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["public-timesheet", v.token] });
    },
  });
}

export function useSubmitPublicTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
    }: {
      token: string;
      timesheetId: string;
    }): Promise<Timesheet> => {
      const { data } = await api.post<Timesheet>(
        `/public/timesheets/${token}/submit`
      );
      return data;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["public-timesheet", v.token] });
    },
  });
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export interface InvoiceFilters {
  status?: InvoiceStatus;
  client_org_id?: string;
  contract_id?: string;
  cursor?: string;
}

export function useInvoices(filters: InvoiceFilters = {}) {
  return useQuery({
    queryKey: ["invoices", filters],
    queryFn: async (): Promise<Invoice[]> => {
      // Backend levert { data: [...], next_cursor } (niet { items }). Onder-
      // steun beide + bare array, met [] als fallback.
      const { data } = await api.get<
        { data?: Invoice[]; items?: Invoice[] } | Invoice[]
      >("/invoices", { params: filters });
      return Array.isArray(data) ? data : data.data ?? data.items ?? [];
    },
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ["invoices", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<Invoice> => {
      if (!id) throw new Error("Geen factuur");
      // Non-standaard envelope: GET /invoices/:id levert { invoice, lines }
      // (GEEN { data }). De detailpagina leest één Invoice met `.lines` erin →
      // lines expliciet in het invoice-object mergen.
      const { data } = await api.get<unknown>(`/invoices/${id}`);
      const { invoice, lines } = data as {
        invoice: Invoice;
        lines: InvoiceLine[];
      };
      return { ...invoice, lines };
    },
  });
}

export interface CreateInvoiceInput {
  contract_id: string;
  period_start: string;
  period_end: string;
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput): Promise<Invoice> => {
      // Non-standaard envelope: POST /invoices levert { invoice, lines }. De
      // consument leest `.id`/`.invoice_number` → het invoice-object teruggeven.
      const { data } = await api.post<unknown>("/invoices", input);
      const { invoice, lines } = data as {
        invoice: Invoice;
        lines: InvoiceLine[];
      };
      return { ...invoice, lines };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useIssueInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Invoice> => {
      const { data } = await api.post<Invoice>(`/invoices/${id}/issue`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useMarkInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      paid_date,
    }: {
      id: string;
      paid_date: string;
    }): Promise<Invoice> => {
      const { data } = await api.post<Invoice>(`/invoices/${id}/mark-paid`, {
        paid_date,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }): Promise<Invoice> => {
      const { data } = await api.post<Invoice>(`/invoices/${id}/void`, {
        reason,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useSyncInvoiceAccounting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Invoice> => {
      const { data } = await api.post<Invoice>(
        `/invoices/${id}/sync-accounting`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export async function downloadInvoicePdf(id: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/invoices/${id}/pdf`, {
    responseType: "blob",
  });
  return data;
}

// ─── Accounting integrations ────────────────────────────────────────────────

export function useAccountingCatalog() {
  return useQuery({
    queryKey: ["accounting", "catalog"],
    queryFn: async (): Promise<AccountingCatalogEntry[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug (anders crasht
      // `.forEach` op het wrapper-object → witte pagina /settings/accounting).
      const { data } = await api.get<{ data: AccountingCatalogEntry[] }>(
        "/accounting/catalog"
      );
      return data.data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useAccountingIntegrations() {
  return useQuery({
    queryKey: ["accounting", "integrations"],
    queryFn: async (): Promise<AccountingIntegration[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug.
      const { data } = await api.get<{ data: AccountingIntegration[] }>(
        "/accounting/integrations"
      );
      return data.data ?? [];
    },
  });
}

export function useConnectAccounting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      provider,
      payload,
    }: {
      provider: AccountingProvider;
      payload?: Record<string, unknown>;
    }): Promise<AccountingIntegration> => {
      const { data } = await api.post<AccountingIntegration>(
        `/accounting/integrations/${provider}/connect`,
        payload ?? {}
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounting"] });
    },
  });
}

export function useDisconnectAccounting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (provider: AccountingProvider): Promise<void> => {
      await api.delete(`/accounting/integrations/${provider}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounting"] });
    },
  });
}

// ─── Commissions ─────────────────────────────────────────────────────────────

export function useCommissionSchemes() {
  return useQuery({
    queryKey: ["commissions", "schemes"],
    queryFn: async (): Promise<CommissionScheme[]> => {
      // Backend wikkelt in { data: [...] } → uitpakken naar array (anders lege
      // lijst omdat de wrapper geen array is).
      const { data } = await api.get<unknown>("/commissions/schemes");
      return unwrapList<CommissionScheme>(data);
    },
  });
}

export function useCreateCommissionScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<CommissionScheme, "id">
    ): Promise<CommissionScheme> => {
      const { data } = await api.post<CommissionScheme>(
        "/commissions/schemes",
        input
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commissions", "schemes"] });
    },
  });
}

export function useUpdateCommissionScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<CommissionScheme>;
    }): Promise<CommissionScheme> => {
      const { data } = await api.patch<CommissionScheme>(
        `/commissions/schemes/${id}`,
        patch
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commissions", "schemes"] });
    },
  });
}

export interface CommissionAssignmentFilters {
  recruiter_id?: string;
  contract_id?: string;
}

export function useCommissionAssignments(
  filters: CommissionAssignmentFilters = {}
) {
  return useQuery({
    queryKey: ["commissions", "assignments", filters],
    queryFn: async (): Promise<CommissionAssignment[]> => {
      // Backend wikkelt in { data: [...] } → uitpakken naar array.
      const { data } = await api.get<unknown>("/commissions/assignments", {
        params: filters,
      });
      return unwrapList<CommissionAssignment>(data);
    },
  });
}

export function useCreateCommissionAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<CommissionAssignment, "id">
    ): Promise<CommissionAssignment> => {
      const { data } = await api.post<CommissionAssignment>(
        "/commissions/assignments",
        input
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commissions", "assignments"] });
    },
  });
}

export interface CommissionRecordFilters {
  recruiter_id?: string;
  status?: CommissionRecordStatus;
  contract_id?: string;
}

export function useCommissionRecords(filters: CommissionRecordFilters = {}) {
  return useQuery({
    queryKey: ["commissions", "records", filters],
    queryFn: async (): Promise<CommissionRecord[]> => {
      // Backend: { data: [...], next_cursor }. Geef de array terug.
      const { data } = await api.get<{ data: CommissionRecord[] }>(
        "/commissions/records",
        { params: filters }
      );
      return data.data ?? [];
    },
  });
}

export function useApproveCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<CommissionRecord> => {
      const { data } = await api.post<CommissionRecord>(
        `/commissions/records/${id}/approve`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commissions", "records"] });
    },
  });
}

export function usePayCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<CommissionRecord> => {
      const { data } = await api.post<CommissionRecord>(
        `/commissions/records/${id}/pay`
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commissions", "records"] });
    },
  });
}

export function useDisputeCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }): Promise<CommissionRecord> => {
      const { data } = await api.post<CommissionRecord>(
        `/commissions/records/${id}/dispute`,
        { reason }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commissions", "records"] });
    },
  });
}

// ─── Forecasting ─────────────────────────────────────────────────────────────

export function useRevenueForecast(monthsAhead = 6) {
  return useQuery({
    queryKey: ["forecasting", "revenue", monthsAhead],
    queryFn: async (): Promise<RevenueForecastMonth[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug.
      const { data } = await api.get<{ data: RevenueForecastMonth[] }>(
        "/forecasting/revenue",
        { params: { months_ahead: monthsAhead } }
      );
      return data.data ?? [];
    },
  });
}

export function useMarginReport(groupBy: MarginGroupBy = "client") {
  return useQuery({
    queryKey: ["forecasting", "margin", groupBy],
    queryFn: async (): Promise<MarginRow[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug (anders crasht
      // `.reduce` op het wrapper-object → witte pagina /analytics/back-office).
      const { data } = await api.get<{ data: MarginRow[] }>(
        "/forecasting/margin",
        { params: { group_by: groupBy } }
      );
      return data.data ?? [];
    },
  });
}

export function useRecomputeForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ ok: true }> => {
      const { data } = await api.post<{ ok: true }>(
        "/forecasting/recompute"
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forecasting"] });
    },
  });
}
