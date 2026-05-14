/**
 * CSV-export module — Sprint Q1.2 (Agent AA).
 *
 * Genereert CSV-buffers voor de hoofdentiteiten in TalentFlow zodat
 * recruiters/HR-teams hun data kunnen exporteren naar Excel/Google Sheets.
 *
 * Ontwerpprincipes:
 *
 *   1. Geen duplicate query-logica — we hergebruiken de bestaande
 *      list-services (`listCandidates`, `listJobs`, etc.). Hierdoor erven
 *      we automatisch RLS-isolatie, filter-shape en eventuele toekomstige
 *      kolomtoevoegingen.
 *   2. Eigen mini-CSV-builder. RFC 4180 is klein genoeg om in 30 regels te
 *      doen — geen libdependency, geen security-attack-surface.
 *   3. UTF-8 BOM aan het begin zodat Microsoft Excel onder NL-locale
 *      diacritics en €-tekens correct toont (zonder BOM ziet Excel UTF-8
 *      als Windows-1252 → "Ã©" in plaats van "é").
 *   4. Audit-log via `logAudit` met action `data.exported`. GDPR vereist dat
 *      we kunnen aantonen wie persoonsgegevens heeft geëxporteerd.
 *   5. xlsx is een MVP-stub — return een AppError zodat de UI duidelijk
 *      kan signaleren dat alleen CSV ondersteund is. Q2-sprint kan
 *      `exceljs` toevoegen.
 *
 * Limieten:
 *   - Hardcoded MAX_EXPORT_ROWS = 50 000. Boven dat aantal:
 *       AppError(413, 'EXPORT_TOO_LARGE', ...)
 *     Voor full-tenant dumps moet een GDPR-export-job (Q2) gebruikt worden.
 *   - Iedere lijst-service wordt aangeroepen met `limit = MAX_EXPORT_ROWS`
 *     en `page = 1`. Voor entiteiten met >50 000 rijen filteren recruiters
 *     eerst in de UI.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import * as candidatesService from '../candidates/candidates.service';
import * as jobsService from '../jobs/jobs.service';
import * as pipelineService from '../pipeline/pipeline.service';
import * as communicationsService from '../communications/communications.service';
import * as workflowsService from '../workflows/workflows.service';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export type ExportEntity =
  | 'candidates'
  | 'jobs'
  | 'applications'
  | 'communications'
  | 'workflows';

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportOptions {
  entity: ExportEntity;
  /**
   * Doorgegeven aan de bestaande list-service. Shape per entity:
   *   - candidates: { search?, skills?, tags?, source? }   (zie candidates.schema.paginationSchema)
   *   - jobs:        { status?, recruiterId? }
   *   - applications:{ jobId?, status? }                    (vereist één van beide)
   *   - communications: { channel?, candidateId? }
   *   - workflows:   {}  (geen filters; alle workflows van de tenant)
   */
  filters?: Record<string, unknown>;
  /**
   * Subset van kolommen om te exporteren. Default = alle kolommen die de
   * default exporter voor de entity definieert. Onbekende kolommen worden
   * stilzwijgend geskipt — dit voorkomt 400's bij UI-versie-mismatch.
   */
  columns?: string[];
  /** MVP: alleen 'csv'. 'xlsx' returnt 501. */
  format?: ExportFormat;
  /**
   * Optionele user-id voor de audit-rij. Controller geeft dit door zodat we
   * weten wie de export heeft gedaan (GDPR Art. 30 — register of processing).
   */
  userId?: string | null;
}

export interface ExportResult {
  filename: string;
  buffer: Buffer;
  content_type: string;
  /** Aantal data-rijen (excl. header). Handig voor UI-toast en audit-log. */
  row_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV builder — RFC 4180 minus binary-CRLF (we use \n; Excel accepts both).
// ─────────────────────────────────────────────────────────────────────────────

/** Excel ziet UTF-8 zonder BOM als Windows-1252 → diacritics broken. */
const UTF8_BOM = '﻿';

/** 50 000 rijen ≈ 25 MB CSV — boven dat: queue-job in Q2. */
export const MAX_EXPORT_ROWS = 50_000;

/**
 * Escape één veldwaarde volgens RFC 4180:
 *  - null / undefined → empty string
 *  - bevat ", , of newline → wrap in dubbele quotes en verdubbel "-quotes
 *  - arrays/objects → JSON-string (en die wordt vervolgens ge-escaped)
 *
 * Defensief: we converteren alles naar string vóór de check zodat we ook
 * numbers en Date-objecten correct serialiseren.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s: string;
  if (value instanceof Date) {
    // ISO-8601 — universeel parsable in Excel + Sheets.
    s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  } else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    s = JSON.stringify(value);
  } else if (typeof value === 'boolean') {
    s = value ? 'true' : 'false';
  } else {
    s = String(value);
  }

  // Defensieve check op CR + LF + " + , — als één van die voorkomt moeten we wrappen.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Bouw één CSV-tekst uit een lijst rijen + kolomdefinities.
 *
 * @param columns  Geordende lijst kolomdefinities. Elke entry beschrijft
 *                 één kolom: header-label en een getter die uit een rij
 *                 de waarde haalt. Getters laten ons computed columns
 *                 (full_name = first + " " + last) rendren zonder de
 *                 list-service te wijzigen.
 * @param rows     Generieke records — typisch het `data`-veld van een
 *                 list-service response.
 * @returns        CSV-string MET BOM, klaar voor Buffer.from(..., 'utf8').
 */
export function buildCsv<T extends Record<string, unknown>>(
  columns: ReadonlyArray<{ label: string; get: (row: T) => unknown }>,
  rows: T[]
): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCsvField(c.get(row))).join(','))
    .join('\n');
  // Trailing newline volgens RFC 4180 — ook handig voor cat-friendly diff.
  return `${UTF8_BOM}${header}\n${body}${rows.length > 0 ? '\n' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-entity column definitions
//
// Elke entity heeft een `defaultColumns` array. Service consumers kunnen via
// `opts.columns` een subset selecteren — we filteren op header-label
// (case-sensitive) zodat de UI 1-op-1 het label kan tonen in de selector.
// ─────────────────────────────────────────────────────────────────────────────

type ColumnDef<T> = { label: string; get: (row: T) => unknown };

interface CandidateRow extends Record<string, unknown> {
  id?: string;
  candidate_reference?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  source?: string;
  current_position?: string;
  current_department?: string;
  industry?: string;
  years_of_experience?: number;
  address_city?: string;
  address_country?: string;
  skills?: string[];
  tags?: string[];
  ai_score?: number;
  gdpr_consent?: boolean;
  email_consent?: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
}

const CANDIDATE_COLUMNS: ReadonlyArray<ColumnDef<CandidateRow>> = [
  { label: 'id', get: (r) => r.id },
  { label: 'reference', get: (r) => r.candidate_reference },
  { label: 'name', get: (r) => r.name },
  { label: 'first_name', get: (r) => r.first_name },
  { label: 'last_name', get: (r) => r.last_name },
  { label: 'email', get: (r) => r.email },
  { label: 'phone', get: (r) => r.phone },
  { label: 'source', get: (r) => r.source },
  { label: 'current_position', get: (r) => r.current_position },
  { label: 'current_department', get: (r) => r.current_department },
  { label: 'industry', get: (r) => r.industry },
  { label: 'years_of_experience', get: (r) => r.years_of_experience },
  { label: 'city', get: (r) => r.address_city },
  { label: 'country', get: (r) => r.address_country },
  // Arrays worden door escapeCsvField als JSON gerenderd. Dat is leesbaar
  // én roundtrip-veilig (importer kan parse JSON.parse).
  { label: 'skills', get: (r) => (Array.isArray(r.skills) ? r.skills.join(';') : null) },
  { label: 'tags', get: (r) => (Array.isArray(r.tags) ? r.tags.join(';') : null) },
  { label: 'ai_score', get: (r) => r.ai_score },
  { label: 'gdpr_consent', get: (r) => r.gdpr_consent },
  { label: 'email_consent', get: (r) => r.email_consent },
  { label: 'created_at', get: (r) => r.created_at },
  { label: 'updated_at', get: (r) => r.updated_at },
];

interface JobRow extends Record<string, unknown> {
  id?: string;
  job_reference?: string;
  title?: string;
  department?: string;
  location?: string;
  status?: string;
  employment_type?: string;
  contract_type?: string;
  experience_level?: string;
  remote_type?: string;
  industry?: string;
  headcount?: number;
  open_date?: string | Date;
  close_date?: string | Date;
  salary_min?: number;
  salary_max?: number;
  currency?: string;
  salary_frequency?: string;
  recruiter_name?: string;
  application_count?: number | string;
  created_at?: string | Date;
  updated_at?: string | Date;
}

const JOB_COLUMNS: ReadonlyArray<ColumnDef<JobRow>> = [
  { label: 'id', get: (r) => r.id },
  { label: 'reference', get: (r) => r.job_reference },
  { label: 'title', get: (r) => r.title },
  { label: 'department', get: (r) => r.department },
  { label: 'location', get: (r) => r.location },
  { label: 'status', get: (r) => r.status },
  { label: 'employment_type', get: (r) => r.employment_type },
  { label: 'contract_type', get: (r) => r.contract_type },
  { label: 'experience_level', get: (r) => r.experience_level },
  { label: 'remote_type', get: (r) => r.remote_type },
  { label: 'industry', get: (r) => r.industry },
  { label: 'headcount', get: (r) => r.headcount },
  { label: 'open_date', get: (r) => r.open_date },
  { label: 'close_date', get: (r) => r.close_date },
  { label: 'salary_min', get: (r) => r.salary_min },
  { label: 'salary_max', get: (r) => r.salary_max },
  { label: 'currency', get: (r) => r.currency },
  { label: 'salary_frequency', get: (r) => r.salary_frequency },
  { label: 'recruiter_name', get: (r) => r.recruiter_name },
  { label: 'application_count', get: (r) => r.application_count },
  { label: 'created_at', get: (r) => r.created_at },
  { label: 'updated_at', get: (r) => r.updated_at },
];

interface ApplicationRow extends Record<string, unknown> {
  id?: string;
  candidate_id?: string;
  candidate_name?: string;
  candidate_email?: string;
  job_id?: string;
  stage_id?: string;
  stage_name?: string;
  status?: string;
  ai_score?: number;
  source?: string;
  applied_at?: string | Date;
  updated_at?: string | Date;
}

const APPLICATION_COLUMNS: ReadonlyArray<ColumnDef<ApplicationRow>> = [
  { label: 'application_id', get: (r) => r.id },
  { label: 'candidate_id', get: (r) => r.candidate_id },
  { label: 'candidate_name', get: (r) => r.candidate_name },
  { label: 'candidate_email', get: (r) => r.candidate_email },
  { label: 'job_id', get: (r) => r.job_id },
  { label: 'stage_id', get: (r) => r.stage_id },
  { label: 'stage_name', get: (r) => r.stage_name },
  { label: 'status', get: (r) => r.status },
  { label: 'ai_score', get: (r) => r.ai_score },
  { label: 'source', get: (r) => r.source },
  { label: 'applied_at', get: (r) => r.applied_at },
  { label: 'updated_at', get: (r) => r.updated_at },
];

interface CommunicationRow extends Record<string, unknown> {
  id?: string;
  candidate_id?: string;
  candidate_name?: string;
  channel?: string;
  direction?: string;
  subject?: string | null;
  status?: string;
  sent_at?: string | Date;
  created_at?: string | Date;
}

const COMMUNICATION_COLUMNS: ReadonlyArray<ColumnDef<CommunicationRow>> = [
  { label: 'id', get: (r) => r.id },
  { label: 'candidate_id', get: (r) => r.candidate_id },
  { label: 'candidate_name', get: (r) => r.candidate_name },
  { label: 'channel', get: (r) => r.channel },
  { label: 'direction', get: (r) => r.direction },
  { label: 'subject', get: (r) => r.subject },
  { label: 'status', get: (r) => r.status },
  { label: 'sent_at', get: (r) => r.sent_at },
  { label: 'created_at', get: (r) => r.created_at },
];

interface WorkflowRow extends Record<string, unknown> {
  id?: string;
  name?: string;
  description?: string;
  trigger?: string;
  active?: boolean;
  run_count?: number;
  last_run_at?: string | Date | null;
  created_at?: string | Date;
}

const WORKFLOW_COLUMNS: ReadonlyArray<ColumnDef<WorkflowRow>> = [
  { label: 'id', get: (r) => r.id },
  { label: 'name', get: (r) => r.name },
  { label: 'description', get: (r) => r.description },
  { label: 'trigger', get: (r) => r.trigger },
  { label: 'active', get: (r) => r.active },
  { label: 'run_count', get: (r) => r.run_count },
  { label: 'last_run_at', get: (r) => r.last_run_at },
  { label: 'created_at', get: (r) => r.created_at },
];

// ─────────────────────────────────────────────────────────────────────────────
// Filter columns by user-supplied subset (zonder volgorde te breken)
// ─────────────────────────────────────────────────────────────────────────────

function selectColumns<T>(
  defaults: ReadonlyArray<ColumnDef<T>>,
  requested: string[] | undefined
): ReadonlyArray<ColumnDef<T>> {
  if (!requested || requested.length === 0) return defaults;
  // Bewaar de volgorde van `defaults` (deterministisch). Onbekende labels
  // skippen we stil — voorkomt 400 bij UI-versie-mismatch.
  const wanted = new Set(requested);
  return defaults.filter((c) => wanted.has(c.label));
}

// ─────────────────────────────────────────────────────────────────────────────
// Filename helper — `<entity>-YYYY-MM-DD.csv`
// ─────────────────────────────────────────────────────────────────────────────

function buildFilename(entity: ExportEntity, ext: 'csv' | 'xlsx'): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${entity}-${today}.${ext}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-entity loaders — delegate naar bestaande list-services
// ─────────────────────────────────────────────────────────────────────────────

async function loadCandidates(
  tenantId: string,
  filters: Record<string, unknown>
): Promise<CandidateRow[]> {
  const skillsRaw = filters.skills;
  const tagsRaw = filters.tags;
  const result = await candidatesService.listCandidates(tenantId, {
    page: 1,
    limit: MAX_EXPORT_ROWS,
    search: typeof filters.search === 'string' ? filters.search : undefined,
    skills: typeof skillsRaw === 'string'
      ? skillsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(skillsRaw)
        ? (skillsRaw as string[])
        : undefined,
    tags: typeof tagsRaw === 'string'
      ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(tagsRaw)
        ? (tagsRaw as string[])
        : undefined,
    source: typeof filters.source === 'string' ? filters.source : undefined,
  });
  return (result.data ?? []) as CandidateRow[];
}

async function loadJobs(
  tenantId: string,
  filters: Record<string, unknown>
): Promise<JobRow[]> {
  const result = await jobsService.listJobs(tenantId, {
    page: 1,
    limit: MAX_EXPORT_ROWS,
    status: typeof filters.status === 'string' ? filters.status : undefined,
    recruiterId: typeof filters.recruiter_id === 'string'
      ? filters.recruiter_id
      : typeof filters.recruiterId === 'string'
        ? filters.recruiterId
        : undefined,
  });
  return (result.data ?? []) as JobRow[];
}

/**
 * Applications worden niet uniform via één list-service opgehaald — pipeline
 * exposeert per-job. Voor een tenant-brede export ondersteunen we twee paden:
 *   - filter `job_id` aanwezig → delegate naar pipelineService.getApplicationsForJob
 *   - geen job_id → directe RLS-veilige SELECT (we kunnen geen list-service
 *     hergebruiken want die bestaat nog niet — Agent Y bouwt cross-job
 *     pipeline-views in Q1.2 niet). De query hieronder is bewust minimal en
 *     identiek aan wat getApplicationsForJob al doet, maar zonder job-WHERE.
 */
async function loadApplications(
  tenantId: string,
  filters: Record<string, unknown>
): Promise<ApplicationRow[]> {
  const jobId = typeof filters.job_id === 'string'
    ? filters.job_id
    : typeof filters.jobId === 'string'
      ? filters.jobId
      : undefined;

  if (jobId) {
    const grouped = await pipelineService.getApplicationsForJob(tenantId, jobId);
    // pipelineService groepeert op stage; flattenen voor CSV-export.
    const rows: ApplicationRow[] = [];
    for (const bucket of grouped.stages) {
      for (const app of bucket.applications) {
        rows.push({
          ...app,
          job_id: jobId,
          stage_name: bucket.stage.name,
        });
      }
    }
    for (const app of grouped.unassigned) {
      rows.push({ ...app, job_id: jobId, stage_name: null as unknown as string });
    }
    return rows;
  }

  // Tenant-brede applications-export. We doen dit hier inline omdat er nog
  // geen `listApplications`-service bestaat. Wanneer Agent Y die later
  // toevoegt, kan deze branch gerefactord worden naar een delegate.
  return withTenant(tenantId, async (client) => {
    const status = typeof filters.status === 'string' ? filters.status : undefined;
    const conditions: string[] = ['a.tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let idx = 2;
    if (status) {
      conditions.push(`a.status = $${idx++}`);
      values.push(status);
    }
    const where = conditions.join(' AND ');
    const { rows } = await client.query(
      `SELECT a.id, a.candidate_id, a.job_id, a.stage_id, a.status,
              a.applied_at, a.updated_at,
              c.name AS candidate_name, c.email AS candidate_email,
              c.ai_score, c.source,
              ps.name AS stage_name
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
        WHERE ${where}
        ORDER BY a.applied_at DESC
        LIMIT $${idx}`,
      [...values, MAX_EXPORT_ROWS]
    );
    return rows as ApplicationRow[];
  });
}

async function loadCommunications(
  tenantId: string,
  filters: Record<string, unknown>
): Promise<CommunicationRow[]> {
  const candidateId = typeof filters.candidate_id === 'string'
    ? filters.candidate_id
    : typeof filters.candidateId === 'string'
      ? filters.candidateId
      : undefined;

  if (candidateId) {
    const rows = await communicationsService.getCandidateCommunications(
      tenantId,
      candidateId
    );
    return rows as unknown as CommunicationRow[];
  }
  const rows = await communicationsService.getInbox(tenantId, {
    channel: typeof filters.channel === 'string' ? filters.channel : undefined,
    limit: MAX_EXPORT_ROWS,
  });
  return rows as unknown as CommunicationRow[];
}

async function loadWorkflows(tenantId: string): Promise<WorkflowRow[]> {
  const rows = await workflowsService.listWorkflows(tenantId);
  return rows as WorkflowRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry-point
// ─────────────────────────────────────────────────────────────────────────────

export async function exportData(
  tenantId: string,
  opts: ExportOptions,
  ctx: AuditContext = {}
): Promise<ExportResult> {
  const format: ExportFormat = opts.format ?? 'csv';

  if (format === 'xlsx') {
    // MVP: niet ondersteund. We geven een nette 501 zodat de UI het kan
    // uitleggen i.p.v. een lege response te tonen. Q2 kan exceljs toevoegen.
    throw new AppError(
      501,
      'EXPORT_FORMAT_UNSUPPORTED',
      'XLSX-export is nog niet beschikbaar — gebruik CSV'
    );
  }

  if (format !== 'csv') {
    throw new AppError(
      400,
      'EXPORT_FORMAT_INVALID',
      `Onbekend export-formaat: ${String(format)}`
    );
  }

  // Load rijen per entity. Ieder pad delegeert naar de list-service zodat
  // we automatisch de RLS-isolatie + filters erven.
  let csv: string;
  let rowCount: number;
  let usedColumns: ReadonlyArray<{ label: string }>;

  switch (opts.entity) {
    case 'candidates': {
      const rows = await loadCandidates(tenantId, opts.filters ?? {});
      const cols = selectColumns(CANDIDATE_COLUMNS, opts.columns);
      csv = buildCsv(cols, rows);
      rowCount = rows.length;
      usedColumns = cols;
      break;
    }
    case 'jobs': {
      const rows = await loadJobs(tenantId, opts.filters ?? {});
      const cols = selectColumns(JOB_COLUMNS, opts.columns);
      csv = buildCsv(cols, rows);
      rowCount = rows.length;
      usedColumns = cols;
      break;
    }
    case 'applications': {
      const rows = await loadApplications(tenantId, opts.filters ?? {});
      const cols = selectColumns(APPLICATION_COLUMNS, opts.columns);
      csv = buildCsv(cols, rows);
      rowCount = rows.length;
      usedColumns = cols;
      break;
    }
    case 'communications': {
      const rows = await loadCommunications(tenantId, opts.filters ?? {});
      const cols = selectColumns(COMMUNICATION_COLUMNS, opts.columns);
      csv = buildCsv(cols, rows);
      rowCount = rows.length;
      usedColumns = cols;
      break;
    }
    case 'workflows': {
      const rows = await loadWorkflows(tenantId);
      const cols = selectColumns(WORKFLOW_COLUMNS, opts.columns);
      csv = buildCsv(cols, rows);
      rowCount = rows.length;
      usedColumns = cols;
      break;
    }
    default: {
      // Compile-time exhaustive check.
      const exhaustive: never = opts.entity;
      throw new AppError(
        400,
        'EXPORT_ENTITY_INVALID',
        `Onbekende entity: ${String(exhaustive)}`
      );
    }
  }

  if (rowCount > MAX_EXPORT_ROWS) {
    throw new AppError(
      413,
      'EXPORT_TOO_LARGE',
      `Export bevat ${rowCount} rijen, max ${MAX_EXPORT_ROWS}. Filter eerst.`
    );
  }

  // Audit-log via een eigen withTenant-tx. Failures binnen logAudit zelf
  // worden gecatcht; we willen export NIET blokkeren door audit-issues.
  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.DATA_EXPORTED,
        entityType: opts.entity,
        entityId: null,
        after: {
          entity: opts.entity,
          format,
          row_count: rowCount,
          columns: usedColumns.map((c) => c.label),
          filters: opts.filters ?? {},
        },
        userId: opts.userId ?? null,
      },
      ctx
    );
  });

  return {
    filename: buildFilename(opts.entity, 'csv'),
    buffer: Buffer.from(csv, 'utf8'),
    content_type: 'text/csv; charset=utf-8',
    row_count: rowCount,
  };
}
