// Sprint Q4.4 — Temp/contract back-office.
// Canonical types between web and api/contracts/timesheets/invoices/accounting/commissions/forecasting routes.

// ─── Contracts ───────────────────────────────────────────────────────────────

export type ContractType = "temp" | "contract" | "permanent" | "freelance";
export type ContractStatus =
  | "draft"
  | "active"
  | "ended"
  | "terminated"
  | "renewed";

export interface Contract {
  id: string;
  tenant_id: string;
  candidate_id: string;
  candidate_name?: string;
  client_organization_id: string | null;
  client_name?: string;
  job_id: string | null;
  job_title?: string;
  contract_type: ContractType;
  status: ContractStatus;
  start_date: string;
  end_date: string | null;
  weekly_hours: number | null;
  hourly_rate_candidate: number | null;
  hourly_rate_client: number | null;
  margin_percent: number | null;
  currency: string;
  cao: string | null;
  wtza_compliant: boolean | null;
  signed_at: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractExtension {
  id: string;
  contract_id: string;
  previous_end_date: string;
  new_end_date: string;
  reason: string | null;
  signed_at: string | null;
}

// ─── Timesheets ──────────────────────────────────────────────────────────────

export type TimesheetStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "disputed";

export interface TimesheetEntry {
  id: string;
  date: string;
  hours: number;
  overtime_hours: number;
  break_minutes: number;
  description: string | null;
  project_code: string | null;
}

export interface Timesheet {
  id: string;
  contract_id: string;
  candidate_id: string;
  week_start: string;
  week_end: string;
  status: TimesheetStatus;
  total_hours: number;
  total_overtime_hours: number;
  notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  entries?: TimesheetEntry[];
  created_at: string;
  updated_at: string;
}

export interface TimesheetSummary {
  contract_id: string;
  period_start: string;
  period_end: string;
  total_hours: number;
  total_overtime_hours: number;
  total_revenue: number;
  total_cost: number;
  margin_amount: number;
  weeks: number;
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  vat_rate: number;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  client_organization_id: string | null;
  client_name?: string;
  contract_id: string | null;
  status: InvoiceStatus;
  period_start: string | null;
  period_end: string | null;
  issued_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  subtotal_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  notes: string | null;
  external_accounting_id: string | null;
  external_accounting_provider: string | null;
  external_synced_at: string | null;
  lines?: InvoiceLine[];
  created_at: string;
}

// ─── Accounting integrations ─────────────────────────────────────────────────

export type AccountingProvider = "exact_online" | "twinfield" | "snelstart";
export type AccountingAuthType = "oauth2" | "api_key";
export type AccountingIntegrationStatus =
  | "connected"
  | "disconnected"
  | "error";

export interface AccountingIntegration {
  id: string;
  provider: AccountingProvider;
  status: AccountingIntegrationStatus;
  display_name: string;
  default_revenue_account: string | null;
  default_vat_code: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface AccountingCatalogEntry {
  provider: AccountingProvider;
  display_name: string;
  description: string;
  auth_type: AccountingAuthType;
  region: "nl" | "eu";
}

// ─── Commissions ─────────────────────────────────────────────────────────────

export type CommissionSchemeType =
  | "flat"
  | "percent_of_fee"
  | "percent_of_margin"
  | "tiered"
  | "recurring_monthly";

export type CommissionRecordStatus =
  | "pending"
  | "approved"
  | "paid"
  | "disputed";

export interface CommissionScheme {
  id: string;
  name: string;
  type: CommissionSchemeType;
  config: Record<string, unknown>;
  active: boolean;
  is_default: boolean;
}

export interface CommissionAssignment {
  id: string;
  recruiter_id: string;
  recruiter_name?: string;
  contract_id: string;
  scheme_id: string;
  scheme_name?: string;
  share_percent: number;
}

export interface CommissionRecord {
  id: string;
  recruiter_id: string;
  recruiter_name?: string;
  contract_id: string;
  invoice_id: string | null;
  base_amount: number;
  commission_amount: number;
  period_start: string | null;
  period_end: string | null;
  status: CommissionRecordStatus;
  paid_at: string | null;
}

// ─── Forecasting ─────────────────────────────────────────────────────────────

export interface RevenueForecastMonth {
  forecast_month: string;
  expected_revenue: number;
  pipeline_revenue: number;
  hires_in_pipeline: number;
  active_contracts: number;
}

export interface MarginRow {
  group_id: string;
  group_name: string;
  total_revenue: number;
  total_cost: number;
  margin_amount: number;
  margin_pct: number;
  contracts: number;
}

export type MarginGroupBy = "client" | "recruiter";
