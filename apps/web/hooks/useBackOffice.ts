"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockAccountingCatalog,
  mockAccountingIntegrations,
  mockCommissionAssignments,
  mockCommissionRecords,
  mockCommissionSchemes,
  mockContractExtensions,
  mockContracts,
  mockInvoices,
  mockMarginByClient,
  mockMarginByRecruiter,
  mockRevenueForecast,
  mockTimesheets,
} from "@/lib/mockData";
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
 *
 * All queries fall back to in-memory mock state when the API is unreachable
 * so the UI is fully demoable without the backend.
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

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockContractsState: Contract[] = [...mockContracts];
let mockExtensionsState: ContractExtension[] = [...mockContractExtensions];
let mockTimesheetsState: Timesheet[] = [...mockTimesheets];
let mockInvoicesState: Invoice[] = [...mockInvoices];
let mockAccountingState: AccountingIntegration[] = [
  ...mockAccountingIntegrations,
];
let mockSchemesState: CommissionScheme[] = [...mockCommissionSchemes];
let mockAssignmentsState: CommissionAssignment[] = [
  ...mockCommissionAssignments,
];
let mockRecordsState: CommissionRecord[] = [...mockCommissionRecords];

function syncContracts() {
  mockContracts.length = 0;
  mockContracts.push(...mockContractsState);
}
function syncExtensions() {
  mockContractExtensions.length = 0;
  mockContractExtensions.push(...mockExtensionsState);
}
function syncTimesheets() {
  mockTimesheets.length = 0;
  mockTimesheets.push(...mockTimesheetsState);
}
function syncInvoices() {
  mockInvoices.length = 0;
  mockInvoices.push(...mockInvoicesState);
}
function syncAccounting() {
  mockAccountingIntegrations.length = 0;
  mockAccountingIntegrations.push(...mockAccountingState);
}
function syncSchemes() {
  mockCommissionSchemes.length = 0;
  mockCommissionSchemes.push(...mockSchemesState);
}
function syncAssignments() {
  mockCommissionAssignments.length = 0;
  mockCommissionAssignments.push(...mockAssignmentsState);
}
function syncRecords() {
  mockCommissionRecords.length = 0;
  mockCommissionRecords.push(...mockRecordsState);
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

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
      try {
        const { data } = await api.get<{ items: Contract[] } | Contract[]>(
          "/contracts",
          { params: filters }
        );
        return Array.isArray(data) ? data : data.items;
      } catch {
        return mockContractsState.filter((c) => {
          if (filters.status && c.status !== filters.status) return false;
          if (filters.candidate_id && c.candidate_id !== filters.candidate_id)
            return false;
          if (filters.job_id && c.job_id !== filters.job_id) return false;
          return true;
        });
      }
    },
  });
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: ["contracts", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<Contract> => {
      if (!id) throw new Error("Geen contract-ID");
      try {
        const { data } = await api.get<Contract>(`/contracts/${id}`);
        return data;
      } catch {
        const found = mockContractsState.find((c) => c.id === id);
        if (!found) throw new Error("Contract niet gevonden");
        return found;
      }
    },
  });
}

export function useContractExtensions(contractId: string | undefined) {
  return useQuery({
    queryKey: ["contracts", contractId ?? "none", "extensions"],
    enabled: !!contractId,
    queryFn: async (): Promise<ContractExtension[]> => {
      if (!contractId) return [];
      try {
        const { data } = await api.get<ContractExtension[]>(
          `/contracts/${contractId}/extensions`
        );
        return data;
      } catch {
        return mockExtensionsState.filter((e) => e.contract_id === contractId);
      }
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
      try {
        const { data } = await api.post<Contract>("/contracts", input);
        return data;
      } catch {
        const margin =
          input.hourly_rate_candidate && input.hourly_rate_client
            ? Math.round(
                ((input.hourly_rate_client - input.hourly_rate_candidate) /
                  input.hourly_rate_client) *
                  1000
              ) / 10
            : null;
        const created: Contract = {
          id: genId("ctr"),
          tenant_id: "tenant-1",
          candidate_id: input.candidate_id,
          candidate_name: input.candidate_name,
          client_organization_id: input.client_organization_id,
          client_name: input.client_name,
          job_id: input.job_id,
          contract_type: input.contract_type,
          status: "draft",
          start_date: input.start_date,
          end_date: input.end_date,
          weekly_hours: input.weekly_hours,
          hourly_rate_candidate: input.hourly_rate_candidate,
          hourly_rate_client: input.hourly_rate_client,
          margin_percent: margin,
          currency: input.currency ?? "EUR",
          cao: input.cao,
          wtza_compliant: input.contract_type === "freelance" ? null : true,
          signed_at: null,
          terminated_at: null,
          termination_reason: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        mockContractsState = [created, ...mockContractsState];
        syncContracts();
        return created;
      }
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
      try {
        const { data } = await api.patch<Contract>(`/contracts/${id}`, patch);
        return data;
      } catch {
        let updated: Contract | null = null;
        mockContractsState = mockContractsState.map((c) => {
          if (c.id !== id) return c;
          updated = { ...c, ...patch, updated_at: nowIso() };
          return updated;
        });
        syncContracts();
        if (!updated) throw new Error("Contract niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Contract>(`/contracts/${id}/extend`, {
          new_end_date,
          reason,
        });
        return data;
      } catch {
        let updated: Contract | null = null;
        mockContractsState = mockContractsState.map((c) => {
          if (c.id !== id) return c;
          const previous_end_date = c.end_date ?? c.start_date;
          mockExtensionsState = [
            {
              id: genId("ext"),
              contract_id: id,
              previous_end_date,
              new_end_date,
              reason,
              signed_at: nowIso(),
            },
            ...mockExtensionsState,
          ];
          updated = {
            ...c,
            end_date: new_end_date,
            status: "active",
            updated_at: nowIso(),
          };
          return updated;
        });
        syncContracts();
        syncExtensions();
        if (!updated) throw new Error("Contract niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Contract>(
          `/contracts/${id}/terminate`,
          { reason, effective_date }
        );
        return data;
      } catch {
        let updated: Contract | null = null;
        mockContractsState = mockContractsState.map((c) => {
          if (c.id !== id) return c;
          updated = {
            ...c,
            status: "terminated",
            terminated_at: nowIso(),
            termination_reason: reason,
            end_date: effective_date ?? c.end_date,
            updated_at: nowIso(),
          };
          return updated;
        });
        syncContracts();
        if (!updated) throw new Error("Contract niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.get<{ items: Timesheet[] } | Timesheet[]>(
          "/timesheets",
          { params: filters }
        );
        return Array.isArray(data) ? data : data.items;
      } catch {
        return mockTimesheetsState.filter((t) => {
          if (filters.contract_id && t.contract_id !== filters.contract_id)
            return false;
          if (filters.status && t.status !== filters.status) return false;
          if (filters.week_start && t.week_start !== filters.week_start)
            return false;
          return true;
        });
      }
    },
  });
}

export function useTimesheet(id: string | undefined) {
  return useQuery({
    queryKey: ["timesheets", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<Timesheet> => {
      if (!id) throw new Error("Geen timesheet-ID");
      try {
        const { data } = await api.get<Timesheet>(`/timesheets/${id}`);
        return data;
      } catch {
        const found = mockTimesheetsState.find((t) => t.id === id);
        if (!found) throw new Error("Timesheet niet gevonden");
        return found;
      }
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
      try {
        const { data } = await api.post<Timesheet>("/timesheets", {
          contract_id,
          week_start,
        });
        return data;
      } catch {
        const week_end = (() => {
          const d = new Date(week_start);
          d.setDate(d.getDate() + 6);
          return d.toISOString().slice(0, 10);
        })();
        const contract = mockContractsState.find((c) => c.id === contract_id);
        const created: Timesheet = {
          id: genId("ts"),
          contract_id,
          candidate_id: contract?.candidate_id ?? "",
          week_start,
          week_end,
          status: "draft",
          total_hours: 0,
          total_overtime_hours: 0,
          notes: null,
          submitted_at: null,
          approved_at: null,
          approved_by: null,
          rejected_at: null,
          rejection_reason: null,
          entries: [],
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        mockTimesheetsState = [created, ...mockTimesheetsState];
        syncTimesheets();
        return created;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
  });
}

function recomputeTotals(t: Timesheet): Timesheet {
  const total_hours = (t.entries ?? []).reduce((s, e) => s + (e.hours || 0), 0);
  const total_overtime_hours = (t.entries ?? []).reduce(
    (s, e) => s + (e.overtime_hours || 0),
    0
  );
  return {
    ...t,
    total_hours: Math.round(total_hours * 100) / 100,
    total_overtime_hours: Math.round(total_overtime_hours * 100) / 100,
  };
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
      try {
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
      } catch {
        const entry: TimesheetEntry = {
          id: genId("tse"),
          date: input.date,
          hours: input.hours,
          overtime_hours: input.overtime_hours ?? 0,
          break_minutes: input.break_minutes ?? 0,
          description: input.description ?? null,
          project_code: input.project_code ?? null,
        };
        mockTimesheetsState = mockTimesheetsState.map((t) =>
          t.id === input.timesheetId
            ? recomputeTotals({
                ...t,
                entries: [...(t.entries ?? []), entry],
                updated_at: nowIso(),
              })
            : t
        );
        syncTimesheets();
        return entry;
      }
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
      try {
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
      } catch {
        let updated: TimesheetEntry | null = null;
        mockTimesheetsState = mockTimesheetsState.map((t) => {
          if (t.id !== input.timesheetId) return t;
          const nextEntries = (t.entries ?? []).map((e) => {
            if (e.id !== input.entryId) return e;
            updated = {
              ...e,
              date: input.date,
              hours: input.hours,
              overtime_hours: input.overtime_hours ?? 0,
              break_minutes: input.break_minutes ?? 0,
              description: input.description ?? null,
              project_code: input.project_code ?? null,
            };
            return updated;
          });
          return recomputeTotals({
            ...t,
            entries: nextEntries,
            updated_at: nowIso(),
          });
        });
        syncTimesheets();
        if (!updated) throw new Error("Entry niet gevonden");
        return updated;
      }
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
      try {
        await api.delete(`/timesheets/${timesheetId}/entries/${entryId}`);
      } catch {
        mockTimesheetsState = mockTimesheetsState.map((t) =>
          t.id === timesheetId
            ? recomputeTotals({
                ...t,
                entries: (t.entries ?? []).filter((e) => e.id !== entryId),
                updated_at: nowIso(),
              })
            : t
        );
        syncTimesheets();
      }
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
      try {
        const { data } = await api.post<Timesheet>(`/timesheets/${id}/submit`);
        return data;
      } catch {
        let updated: Timesheet | null = null;
        mockTimesheetsState = mockTimesheetsState.map((t) => {
          if (t.id !== id) return t;
          updated = {
            ...t,
            status: "submitted",
            submitted_at: nowIso(),
            updated_at: nowIso(),
          };
          return updated;
        });
        syncTimesheets();
        if (!updated) throw new Error("Timesheet niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Timesheet>(`/timesheets/${id}/approve`);
        return data;
      } catch {
        let updated: Timesheet | null = null;
        mockTimesheetsState = mockTimesheetsState.map((t) => {
          if (t.id !== id) return t;
          updated = {
            ...t,
            status: "approved",
            approved_at: nowIso(),
            approved_by: "user-1",
            updated_at: nowIso(),
          };
          return updated;
        });
        syncTimesheets();
        if (!updated) throw new Error("Timesheet niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Timesheet>(
          `/timesheets/${id}/reject`,
          { reason }
        );
        return data;
      } catch {
        let updated: Timesheet | null = null;
        mockTimesheetsState = mockTimesheetsState.map((t) => {
          if (t.id !== id) return t;
          updated = {
            ...t,
            status: "rejected",
            rejected_at: nowIso(),
            rejection_reason: reason,
            updated_at: nowIso(),
          };
          return updated;
        });
        syncTimesheets();
        if (!updated) throw new Error("Timesheet niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Timesheet>(
          `/timesheets/${id}/dispute`,
          { reason }
        );
        return data;
      } catch {
        let updated: Timesheet | null = null;
        mockTimesheetsState = mockTimesheetsState.map((t) => {
          if (t.id !== id) return t;
          updated = {
            ...t,
            status: "disputed",
            rejection_reason: reason,
            updated_at: nowIso(),
          };
          return updated;
        });
        syncTimesheets();
        if (!updated) throw new Error("Timesheet niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.get<TimesheetSummary>(
          "/timesheets/summary",
          {
            params: {
              contract_id: contractId,
              period_start: periodStart,
              period_end: periodEnd,
            },
          }
        );
        return data;
      } catch {
        const contract = mockContractsState.find((c) => c.id === contractId);
        const sheets = mockTimesheetsState.filter((t) => {
          if (t.contract_id !== contractId) return false;
          if (periodStart && t.week_end < periodStart) return false;
          if (periodEnd && t.week_start > periodEnd) return false;
          return true;
        });
        const total_hours = sheets.reduce((s, t) => s + t.total_hours, 0);
        const total_overtime_hours = sheets.reduce(
          (s, t) => s + t.total_overtime_hours,
          0
        );
        const total_revenue =
          total_hours * (contract?.hourly_rate_client ?? 0) +
          total_overtime_hours * (contract?.hourly_rate_client ?? 0) * 1.25;
        const total_cost =
          total_hours * (contract?.hourly_rate_candidate ?? 0) +
          total_overtime_hours * (contract?.hourly_rate_candidate ?? 0) * 1.25;
        return {
          contract_id: contractId,
          period_start: periodStart ?? sheets[0]?.week_start ?? "",
          period_end:
            periodEnd ?? sheets[sheets.length - 1]?.week_end ?? "",
          total_hours,
          total_overtime_hours,
          total_revenue: Math.round(total_revenue * 100) / 100,
          total_cost: Math.round(total_cost * 100) / 100,
          margin_amount:
            Math.round((total_revenue - total_cost) * 100) / 100,
          weeks: sheets.length,
        };
      }
    },
  });
}

// ─── Public timesheet portaal (token-based) ─────────────────────────────────

export interface PublicTimesheetData {
  timesheet: Timesheet;
  contract: Pick<
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
      try {
        const { data } = await api.get<PublicTimesheetData>(
          `/public/timesheets/${token}`
        );
        return data;
      } catch {
        // Mock: return the latest draft/rejected timesheet for ctr-1.
        const ts =
          mockTimesheetsState.find(
            (t) => t.contract_id === "ctr-1" && t.status === "draft"
          ) ??
          mockTimesheetsState.find((t) => t.contract_id === "ctr-1") ??
          mockTimesheetsState[0];
        const contract = mockContractsState.find(
          (c) => c.id === ts.contract_id
        )!;
        return {
          timesheet: ts,
          contract: {
            id: contract.id,
            candidate_name: contract.candidate_name,
            client_name: contract.client_name,
            weekly_hours: contract.weekly_hours,
            hourly_rate_candidate: contract.hourly_rate_candidate,
            currency: contract.currency,
          },
        };
      }
    },
  });
}

export function useSavePublicEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
      entryId,
      timesheetId,
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
      try {
        const { data } = await api.post<TimesheetEntry>(
          `/public/timesheets/${token}/entries`,
          { entry_id: entryId, ...rest }
        );
        return data;
      } catch {
        let saved: TimesheetEntry | null = null;
        mockTimesheetsState = mockTimesheetsState.map((t) => {
          if (t.id !== timesheetId) return t;
          const entries = [...(t.entries ?? [])];
          if (entryId) {
            const idx = entries.findIndex((e) => e.id === entryId);
            if (idx >= 0) {
              saved = {
                ...entries[idx],
                date: rest.date,
                hours: rest.hours,
                overtime_hours: rest.overtime_hours ?? 0,
                break_minutes: rest.break_minutes ?? 0,
                description: rest.description ?? null,
                project_code: rest.project_code ?? null,
              };
              entries[idx] = saved;
            }
          } else {
            // Find matching by date or append.
            const idx = entries.findIndex((e) => e.date === rest.date);
            saved = {
              id: idx >= 0 ? entries[idx].id : genId("tse"),
              date: rest.date,
              hours: rest.hours,
              overtime_hours: rest.overtime_hours ?? 0,
              break_minutes: rest.break_minutes ?? 0,
              description: rest.description ?? null,
              project_code: rest.project_code ?? null,
            };
            if (idx >= 0) entries[idx] = saved;
            else entries.push(saved);
          }
          return recomputeTotals({
            ...t,
            entries,
            updated_at: nowIso(),
          });
        });
        syncTimesheets();
        if (!saved) throw new Error("Entry niet opgeslagen");
        return saved;
      }
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
      timesheetId,
    }: {
      token: string;
      timesheetId: string;
    }): Promise<Timesheet> => {
      try {
        const { data } = await api.post<Timesheet>(
          `/public/timesheets/${token}/submit`
        );
        return data;
      } catch {
        let updated: Timesheet | null = null;
        mockTimesheetsState = mockTimesheetsState.map((t) => {
          if (t.id !== timesheetId) return t;
          updated = {
            ...t,
            status: "submitted",
            submitted_at: nowIso(),
            rejected_at: null,
            rejection_reason: null,
            updated_at: nowIso(),
          };
          return updated;
        });
        syncTimesheets();
        if (!updated) throw new Error("Timesheet niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.get<{ items: Invoice[] } | Invoice[]>(
          "/invoices",
          { params: filters }
        );
        return Array.isArray(data) ? data : data.items;
      } catch {
        return mockInvoicesState.filter((i) => {
          if (filters.status && i.status !== filters.status) return false;
          if (
            filters.client_org_id &&
            i.client_organization_id !== filters.client_org_id
          )
            return false;
          if (filters.contract_id && i.contract_id !== filters.contract_id)
            return false;
          return true;
        });
      }
    },
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ["invoices", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<Invoice> => {
      if (!id) throw new Error("Geen factuur");
      try {
        const { data } = await api.get<Invoice>(`/invoices/${id}`);
        return data;
      } catch {
        const found = mockInvoicesState.find((i) => i.id === id);
        if (!found) throw new Error("Factuur niet gevonden");
        return found;
      }
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
      try {
        const { data } = await api.post<Invoice>("/invoices", input);
        return data;
      } catch {
        const contract = mockContractsState.find(
          (c) => c.id === input.contract_id
        );
        if (!contract) throw new Error("Contract niet gevonden");
        const sheetsInPeriod = mockTimesheetsState.filter(
          (t) =>
            t.contract_id === input.contract_id &&
            t.week_start >= input.period_start &&
            t.week_end <= input.period_end &&
            (t.status === "approved" || t.status === "submitted")
        );
        const total_hours = sheetsInPeriod.reduce(
          (s, t) => s + t.total_hours,
          0
        );
        const overtime_hours = sheetsInPeriod.reduce(
          (s, t) => s + t.total_overtime_hours,
          0
        );
        const unit = contract.hourly_rate_client ?? 100;
        const lines: InvoiceLine[] = [
          {
            id: genId("ln"),
            description: `Reguliere uren — ${contract.candidate_name ?? "kandidaat"}`,
            quantity: total_hours,
            unit: "uur",
            unit_price: unit,
            line_total: total_hours * unit,
            vat_rate: 21,
          },
        ];
        if (overtime_hours > 0) {
          lines.push({
            id: genId("ln"),
            description: "Overuren (1.25×)",
            quantity: overtime_hours,
            unit: "uur",
            unit_price: unit * 1.25,
            line_total: overtime_hours * unit * 1.25,
            vat_rate: 21,
          });
        }
        const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
        const vat_amount = Math.round(subtotal * 0.21 * 100) / 100;
        const next_seq =
          mockInvoicesState.filter((i) =>
            i.invoice_number.startsWith("TF-2026-")
          ).length + 1;
        const created: Invoice = {
          id: genId("inv"),
          tenant_id: "tenant-1",
          invoice_number: `TF-2026-${String(next_seq).padStart(4, "0")}`,
          client_organization_id: contract.client_organization_id,
          client_name: contract.client_name,
          contract_id: contract.id,
          status: "draft",
          period_start: input.period_start,
          period_end: input.period_end,
          issued_date: null,
          due_date: null,
          paid_date: null,
          subtotal_amount: subtotal,
          vat_rate: 21,
          vat_amount,
          total_amount: Math.round((subtotal + vat_amount) * 100) / 100,
          currency: contract.currency,
          notes: null,
          external_accounting_id: null,
          external_accounting_provider: null,
          external_synced_at: null,
          lines,
          created_at: nowIso(),
        };
        mockInvoicesState = [created, ...mockInvoicesState];
        syncInvoices();
        return created;
      }
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
      try {
        const { data } = await api.post<Invoice>(`/invoices/${id}/issue`);
        return data;
      } catch {
        let updated: Invoice | null = null;
        mockInvoicesState = mockInvoicesState.map((i) => {
          if (i.id !== id) return i;
          const issued = todayDate();
          const due = (() => {
            const d = new Date();
            d.setDate(d.getDate() + 30);
            return d.toISOString().slice(0, 10);
          })();
          updated = {
            ...i,
            status: "sent",
            issued_date: issued,
            due_date: due,
          };
          return updated;
        });
        syncInvoices();
        if (!updated) throw new Error("Factuur niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Invoice>(`/invoices/${id}/mark-paid`, {
          paid_date,
        });
        return data;
      } catch {
        let updated: Invoice | null = null;
        mockInvoicesState = mockInvoicesState.map((i) => {
          if (i.id !== id) return i;
          updated = { ...i, status: "paid", paid_date };
          return updated;
        });
        syncInvoices();
        if (!updated) throw new Error("Factuur niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Invoice>(`/invoices/${id}/void`, {
          reason,
        });
        return data;
      } catch {
        let updated: Invoice | null = null;
        mockInvoicesState = mockInvoicesState.map((i) => {
          if (i.id !== id) return i;
          updated = { ...i, status: "void", notes: reason };
          return updated;
        });
        syncInvoices();
        if (!updated) throw new Error("Factuur niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.post<Invoice>(
          `/invoices/${id}/sync-accounting`
        );
        return data;
      } catch {
        let updated: Invoice | null = null;
        mockInvoicesState = mockInvoicesState.map((i) => {
          if (i.id !== id) return i;
          const provider =
            mockAccountingState.find((a) => a.status === "connected")
              ?.provider ?? "exact_online";
          updated = {
            ...i,
            external_accounting_id: `EOL-FIN-${i.invoice_number.replace(
              "TF-",
              ""
            )}`,
            external_accounting_provider: provider,
            external_synced_at: nowIso(),
          };
          return updated;
        });
        syncInvoices();
        if (!updated) throw new Error("Factuur niet gevonden");
        return updated;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export async function downloadInvoicePdf(id: string): Promise<Blob> {
  try {
    const { data } = await api.get<Blob>(`/invoices/${id}/pdf`, {
      responseType: "blob",
    });
    return data;
  } catch {
    // Mock: return a tiny fake "PDF" blob for the demo.
    const text = `MOCK PDF — Factuur ${id}\nGegenereerd op ${new Date().toISOString()}\n`;
    return new Blob([text], { type: "application/pdf" });
  }
}

// ─── Accounting integrations ────────────────────────────────────────────────

export function useAccountingCatalog() {
  return useQuery({
    queryKey: ["accounting", "catalog"],
    queryFn: async (): Promise<AccountingCatalogEntry[]> => {
      try {
        const { data } = await api.get<AccountingCatalogEntry[]>(
          "/accounting/catalog"
        );
        return data;
      } catch {
        return [...mockAccountingCatalog];
      }
    },
    staleTime: 60_000,
  });
}

export function useAccountingIntegrations() {
  return useQuery({
    queryKey: ["accounting", "integrations"],
    queryFn: async (): Promise<AccountingIntegration[]> => {
      try {
        const { data } = await api.get<AccountingIntegration[]>(
          "/accounting/integrations"
        );
        return data;
      } catch {
        return [...mockAccountingState];
      }
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
      try {
        const { data } = await api.post<AccountingIntegration>(
          `/accounting/integrations/${provider}/connect`,
          payload ?? {}
        );
        return data;
      } catch {
        const catalog = mockAccountingCatalog.find(
          (c) => c.provider === provider
        );
        const existing = mockAccountingState.find(
          (a) => a.provider === provider
        );
        const now = nowIso();
        if (existing) {
          existing.status = "connected";
          existing.connected_at = now;
          existing.last_synced_at = now;
          existing.last_error = null;
          existing.default_revenue_account =
            (payload?.default_revenue_account as string | undefined) ??
            existing.default_revenue_account;
          existing.default_vat_code =
            (payload?.default_vat_code as string | undefined) ??
            existing.default_vat_code;
          syncAccounting();
          return existing;
        }
        const created: AccountingIntegration = {
          id: genId("acct"),
          provider,
          status: "connected",
          display_name: catalog?.display_name ?? provider,
          default_revenue_account:
            (payload?.default_revenue_account as string | undefined) ?? "8000",
          default_vat_code:
            (payload?.default_vat_code as string | undefined) ?? "VH-21",
          connected_at: now,
          last_synced_at: now,
          last_error: null,
        };
        mockAccountingState = [...mockAccountingState, created];
        syncAccounting();
        return created;
      }
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
      try {
        await api.delete(`/accounting/integrations/${provider}`);
      } catch {
        mockAccountingState = mockAccountingState.filter(
          (a) => a.provider !== provider
        );
        syncAccounting();
      }
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
      try {
        const { data } = await api.get<CommissionScheme[]>(
          "/commissions/schemes"
        );
        return data;
      } catch {
        return [...mockSchemesState];
      }
    },
  });
}

export function useCreateCommissionScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<CommissionScheme, "id">
    ): Promise<CommissionScheme> => {
      try {
        const { data } = await api.post<CommissionScheme>(
          "/commissions/schemes",
          input
        );
        return data;
      } catch {
        const created: CommissionScheme = { id: genId("scheme"), ...input };
        mockSchemesState = [...mockSchemesState, created];
        syncSchemes();
        return created;
      }
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
      try {
        const { data } = await api.patch<CommissionScheme>(
          `/commissions/schemes/${id}`,
          patch
        );
        return data;
      } catch {
        let updated: CommissionScheme | null = null;
        mockSchemesState = mockSchemesState.map((s) => {
          if (s.id !== id) return s;
          updated = { ...s, ...patch };
          return updated;
        });
        syncSchemes();
        if (!updated) throw new Error("Scheme niet gevonden");
        return updated;
      }
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
      try {
        const { data } = await api.get<CommissionAssignment[]>(
          "/commissions/assignments",
          { params: filters }
        );
        return data;
      } catch {
        return mockAssignmentsState.filter((a) => {
          if (filters.recruiter_id && a.recruiter_id !== filters.recruiter_id)
            return false;
          if (filters.contract_id && a.contract_id !== filters.contract_id)
            return false;
          return true;
        });
      }
    },
  });
}

export function useCreateCommissionAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<CommissionAssignment, "id">
    ): Promise<CommissionAssignment> => {
      try {
        const { data } = await api.post<CommissionAssignment>(
          "/commissions/assignments",
          input
        );
        return data;
      } catch {
        const created: CommissionAssignment = {
          id: genId("comm-asg"),
          ...input,
        };
        mockAssignmentsState = [...mockAssignmentsState, created];
        syncAssignments();
        return created;
      }
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
      try {
        const { data } = await api.get<CommissionRecord[]>(
          "/commissions/records",
          { params: filters }
        );
        return data;
      } catch {
        return mockRecordsState.filter((r) => {
          if (filters.recruiter_id && r.recruiter_id !== filters.recruiter_id)
            return false;
          if (filters.status && r.status !== filters.status) return false;
          if (filters.contract_id && r.contract_id !== filters.contract_id)
            return false;
          return true;
        });
      }
    },
  });
}

function mutateCommissionRecord(
  id: string,
  next: CommissionRecordStatus,
  extra: Partial<CommissionRecord> = {}
): CommissionRecord {
  let updated: CommissionRecord | null = null;
  mockRecordsState = mockRecordsState.map((r) => {
    if (r.id !== id) return r;
    updated = { ...r, status: next, ...extra };
    return updated;
  });
  syncRecords();
  if (!updated) throw new Error("Commissie niet gevonden");
  return updated;
}

export function useApproveCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<CommissionRecord> => {
      try {
        const { data } = await api.post<CommissionRecord>(
          `/commissions/records/${id}/approve`
        );
        return data;
      } catch {
        return mutateCommissionRecord(id, "approved");
      }
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
      try {
        const { data } = await api.post<CommissionRecord>(
          `/commissions/records/${id}/pay`
        );
        return data;
      } catch {
        return mutateCommissionRecord(id, "paid", { paid_at: nowIso() });
      }
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
      try {
        const { data } = await api.post<CommissionRecord>(
          `/commissions/records/${id}/dispute`,
          { reason }
        );
        return data;
      } catch {
        return mutateCommissionRecord(id, "disputed");
      }
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
      try {
        const { data } = await api.get<RevenueForecastMonth[]>(
          "/forecasting/revenue",
          { params: { months_ahead: monthsAhead } }
        );
        return data;
      } catch {
        return mockRevenueForecast.slice(0, monthsAhead);
      }
    },
  });
}

export function useMarginReport(groupBy: MarginGroupBy = "client") {
  return useQuery({
    queryKey: ["forecasting", "margin", groupBy],
    queryFn: async (): Promise<MarginRow[]> => {
      try {
        const { data } = await api.get<MarginRow[]>("/forecasting/margin", {
          params: { group_by: groupBy },
        });
        return data;
      } catch {
        return groupBy === "recruiter"
          ? [...mockMarginByRecruiter]
          : [...mockMarginByClient];
      }
    },
  });
}

export function useRecomputeForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ ok: true }> => {
      try {
        const { data } = await api.post<{ ok: true }>(
          "/forecasting/recompute"
        );
        return data;
      } catch {
        return { ok: true };
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forecasting"] });
    },
  });
}
