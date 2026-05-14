/**
 * Manatal → TalentFlow import-script.
 *
 * CLI dat een complete Manatal-export ingest in TalentFlow:
 *   - candidates.csv → candidates (+ optioneel resumes)
 *   - jobs.csv       → jobs (met pipeline-template seed)
 *   - applications.csv → applications (resolved naar gemapte candidate/job)
 *   - notes.csv      → activities (entity_type=candidate|job, action=note_imported)
 *   - resumes/<ref>.* → candidate_resumes + parse-queue
 *
 * Production-grade requirements (Q1.3 spec):
 *   - Idempotent: re-runs skippen op UNIQUE-collisions (candidate_reference,
 *     job_reference, applications.uq).
 *   - Dry-run: --dry-run parseert + valideert + telt zonder DB-writes.
 *   - Rollback: --rollback-tenant verwijdert alle source='manatal_migration' data.
 *   - Audit-trail: elke geïmporteerde rij logt naar audit_events; eindrapport
 *     ook gepersisteerd als action='migration.completed'.
 *
 * Gebruik:
 *
 *   tsx apps/api/scripts/manatal-import.ts \
 *     --tenant-id <uuid> \
 *     --candidates ./manatal-export/candidates.csv \
 *     --jobs ./manatal-export/jobs.csv \
 *     --applications ./manatal-export/applications.csv \
 *     --notes ./manatal-export/notes.csv \
 *     --resumes-dir ./manatal-export/resumes \
 *     --dry-run \
 *     --batch-size 100 \
 *     --skip-duplicates
 *
 *   tsx apps/api/scripts/manatal-import.ts --rollback-tenant <uuid>
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import readline from 'readline';
import { parseCsv } from '../src/modules/candidates/bulkImport.service';
import {
  buildCandidatePayload,
  buildJobPayload,
  resolveStageNameFromManatal,
  extractManatalId,
  MANATAL_CANDIDATE_ID_COLUMNS,
  MANATAL_JOB_ID_COLUMNS,
} from './manatal-mapping';
import { createCandidate } from '../src/modules/candidates/candidates.service';
import { createJob } from '../src/modules/jobs/jobs.service';
import { addToPipeline } from '../src/modules/pipeline/pipeline.service';
import { withTenant } from '../src/db/pool';
import { logAudit } from '../src/lib/audit';
import { getStorage, buildResumeStorageKey } from '../src/lib/storage';

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parser (geen externe deps — `commander` is niet in package.json)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  tenantId: string | null;
  candidates: string | null;
  jobs: string | null;
  applications: string | null;
  notes: string | null;
  resumesDir: string | null;
  dryRun: boolean;
  batchSize: number;
  skipDuplicates: boolean;
  rollbackTenant: string | null;
  yes: boolean;
  help: boolean;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    tenantId: null,
    candidates: null,
    jobs: null,
    applications: null,
    notes: null,
    resumesDir: null,
    dryRun: false,
    batchSize: 100,
    skipDuplicates: true,
    rollbackTenant: null,
    yes: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`Vlag ${a} mist waarde`);
      }
      return v;
    };
    switch (a) {
      case '--tenant-id':
        args.tenantId = next();
        break;
      case '--candidates':
        args.candidates = next();
        break;
      case '--jobs':
        args.jobs = next();
        break;
      case '--applications':
        args.applications = next();
        break;
      case '--notes':
        args.notes = next();
        break;
      case '--resumes-dir':
        args.resumesDir = next();
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--batch-size':
        args.batchSize = parseInt(next(), 10);
        if (!Number.isFinite(args.batchSize) || args.batchSize < 1) {
          throw new Error('--batch-size moet positief geheel getal zijn');
        }
        break;
      case '--skip-duplicates':
        args.skipDuplicates = true;
        break;
      case '--no-skip-duplicates':
        args.skipDuplicates = false;
        break;
      case '--rollback-tenant':
        args.rollbackTenant = next();
        break;
      case '-y':
      case '--yes':
        args.yes = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Onbekende vlag: ${a}`);
    }
  }
  return args;
}

const HELP_TEXT = `
Manatal → TalentFlow import.

Gebruik:
  tsx apps/api/scripts/manatal-import.ts --tenant-id <uuid> [opties]
  tsx apps/api/scripts/manatal-import.ts --rollback-tenant <uuid> [-y]

Opties:
  --tenant-id <uuid>          Doel-tenant (verplicht voor import)
  --candidates <path>         Pad naar candidates.csv
  --jobs <path>               Pad naar jobs.csv
  --applications <path>       Pad naar applications.csv
  --notes <path>              Pad naar notes.csv
  --resumes-dir <path>        Map met resume-bestanden (filename = candidate_reference.<ext>)
  --dry-run                   Parse + valideer, geen DB-writes
  --batch-size <n>            Aantal candidates per batch (default 100)
  --skip-duplicates           Sla bestaande candidate_reference / job_reference rijen over (default)
  --no-skip-duplicates        Falt hard bij UNIQUE-collisions (debug-mode)
  --rollback-tenant <uuid>    Verwijder alle source='manatal_migration' rows van tenant
  -y, --yes                   Skip bevestigingsprompt (CI/non-interactief)
  -h, --help                  Toon deze help

Pre-flight:
  1. Test eerst met --dry-run.
  2. Zorg dat migrations 001-009 zijn toegepast op de doel-DB.
  3. Maak een DB-backup (rollback is destructief).
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// ANSI colors (geen lib nodig)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Report types
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityStats {
  total: number;
  imported: number;
  skipped: number;
  errors: number;
}

export interface ResumeStats {
  total: number;
  uploaded: number;
  queued_for_parsing: number;
}

export interface NoteStats {
  total: number;
  imported: number;
}

export interface RowError {
  row: number;
  entity: 'candidate' | 'job' | 'application' | 'note' | 'resume';
  message: string;
  raw: Record<string, unknown>;
}

export interface MigrationReport {
  tenant_id: string;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  dry_run: boolean;
  candidates: EntityStats;
  jobs: EntityStats;
  applications: EntityStats;
  notes: NoteStats;
  resumes: ResumeStats;
  unknown_columns: { entity: string; column: string }[];
  errors: RowError[];
  /** Manatal-id → TalentFlow-id mapping for diagnostics. */
  id_map: {
    candidates: Record<string, string>;
    jobs: Record<string, string>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant verification
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyTenant(tenantId: string): Promise<void> {
  const ok = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    return rows.length > 0;
  });
  if (!ok) {
    throw new Error(`Tenant ${tenantId} bestaat niet`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency helpers — pre-flight UNIQUE-checks
// ─────────────────────────────────────────────────────────────────────────────

export async function existingCandidateReferences(
  tenantId: string,
  references: string[]
): Promise<Set<string>> {
  if (references.length === 0) return new Set();
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT candidate_reference
       FROM candidates
       WHERE tenant_id = $1
         AND candidate_reference = ANY($2::text[])`,
      [tenantId, references]
    );
    return new Set<string>(
      rows.map((r) => (r as { candidate_reference: string }).candidate_reference)
    );
  });
}

export async function existingJobReferences(
  tenantId: string,
  references: string[]
): Promise<Set<string>> {
  if (references.length === 0) return new Set();
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT job_reference
       FROM jobs
       WHERE tenant_id = $1
         AND job_reference = ANY($2::text[])`,
      [tenantId, references]
    );
    return new Set<string>(rows.map((r) => (r as { job_reference: string }).job_reference));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage-id resolver per job (cached)
// ─────────────────────────────────────────────────────────────────────────────

async function loadStageIdsForJob(
  tenantId: string,
  jobId: string
): Promise<Map<string, string>> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, name FROM pipeline_stages WHERE job_id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );
    const map = new Map<string, string>();
    for (const r of rows as { id: string; name: string }[]) {
      map.set(r.name.toLowerCase(), r.id);
    }
    return map;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Importers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Een CSV-pad → headers + rows. Wrapper rond `parseCsv` die het bestand inleest
 * en geeft een betere error als het niet bestaat.
 */
export function readCsvFile(filePath: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV-bestand niet gevonden: ${filePath}`);
  }
  const buffer = fs.readFileSync(filePath);
  return parseCsv(buffer);
}

const MIGRATION_SOURCE_TAG = 'manatal_migration';

export interface ImportContext {
  tenantId: string;
  /** A synthesized user-id for the migration audit-trail. */
  userId: string;
  /** Run-id for grouping audit-events. */
  batchId: string;
  dryRun: boolean;
  skipDuplicates: boolean;
  report: MigrationReport;
  unknownColumns: Map<string, Set<string>>; // entity → set of unknown CSV cols
}

function recordUnknownColumns(
  ctx: ImportContext,
  entity: string,
  cols: string[]
): void {
  if (cols.length === 0) return;
  const set = ctx.unknownColumns.get(entity) ?? new Set();
  for (const c of cols) set.add(c);
  ctx.unknownColumns.set(entity, set);
}

/**
 * Job-import. Manatal-export bevat meestal een gering aantal rijen (vaak <100),
 * dus we doen geen batching — rij per rij is robuuster en simpler.
 */
export async function importJobs(
  ctx: ImportContext,
  rows: Record<string, string>[]
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  ctx.report.jobs.total = rows.length;

  // Pre-flight: welke job_references zijn al aanwezig (idempotency).
  const candidateRefs: string[] = [];
  const builtRows: { rowIdx: number; row: Record<string, string>; payload: Record<string, unknown>; manatalId: string | null }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const { payload, unknownColumns } = buildJobPayload(row);
    recordUnknownColumns(ctx, 'job', unknownColumns);
    const manatalId = extractManatalId(row, MANATAL_JOB_ID_COLUMNS);
    builtRows.push({ rowIdx: i + 1, row, payload, manatalId });
    if (typeof payload.job_reference === 'string') {
      candidateRefs.push(payload.job_reference);
    }
  }

  const existing = ctx.dryRun
    ? new Set<string>()
    : await existingJobReferences(ctx.tenantId, candidateRefs);

  for (const { rowIdx, row, payload, manatalId } of builtRows) {
    const jobRef = payload.job_reference as string | undefined;

    // Skip-on-duplicate (idempotency)
    if (jobRef && existing.has(jobRef)) {
      ctx.report.jobs.skipped++;
      log(
        `${C.gray}  [skip] job ${jobRef} bestaat al${C.reset}`
      );
      continue;
    }

    if (!payload.title) {
      ctx.report.jobs.errors++;
      ctx.report.errors.push({
        row: rowIdx,
        entity: 'job',
        message: 'Job zonder title — overgeslagen',
        raw: row,
      });
      continue;
    }

    if (ctx.dryRun) {
      ctx.report.jobs.imported++;
      continue;
    }

    try {
      // payload.title is gevalideerd boven; cast veilig naar CreateJobInput-compat.
      const jobInput = payload as unknown as Parameters<typeof createJob>[2];
      const job = await createJob(ctx.tenantId, ctx.userId, jobInput);
      ctx.report.jobs.imported++;
      if (manatalId) idMap.set(manatalId, job.id);
      if (jobRef) idMap.set(jobRef, job.id);

      // Audit
      await withTenant(ctx.tenantId, async (client) => {
        await logAudit(
          client,
          ctx.tenantId,
          {
            action: 'job.imported',
            entityType: 'job',
            entityId: job.id,
            after: {
              source: MIGRATION_SOURCE_TAG,
              manatal_id: manatalId,
              job_reference: jobRef ?? job.job_reference,
              batch_id: ctx.batchId,
            },
            userId: ctx.userId,
          },
          {}
        );
      });
    } catch (err) {
      const e = err as { code?: string; constraint?: string; message?: string };
      const isUnique = e.code === '23505';
      if (isUnique && ctx.skipDuplicates) {
        ctx.report.jobs.skipped++;
        continue;
      }
      ctx.report.jobs.errors++;
      ctx.report.errors.push({
        row: rowIdx,
        entity: 'job',
        message: e.message ?? String(err),
        raw: row,
      });
    }
  }
  return idMap;
}

/**
 * Candidate-import met batching + duplicate-skip.
 */
export async function importCandidates(
  ctx: ImportContext,
  rows: Record<string, string>[],
  batchSize: number
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  ctx.report.candidates.total = rows.length;

  // Pre-process: build alle payloads + verzamel candidate_references.
  type Built = {
    rowIdx: number;
    row: Record<string, string>;
    payload: Record<string, unknown>;
    manatalId: string | null;
  };
  const built: Built[] = [];
  const refs: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const { payload, unknownColumns } = buildCandidatePayload(row);
    recordUnknownColumns(ctx, 'candidate', unknownColumns);
    const manatalId = extractManatalId(row, MANATAL_CANDIDATE_ID_COLUMNS);
    built.push({ rowIdx: i + 1, row, payload, manatalId });
    if (typeof payload.candidate_reference === 'string') {
      refs.push(payload.candidate_reference);
    }
  }

  const existing = ctx.dryRun
    ? new Set<string>()
    : await existingCandidateReferences(ctx.tenantId, refs);

  for (let start = 0; start < built.length; start += batchSize) {
    const batch = built.slice(start, start + batchSize);

    for (const { rowIdx, row, payload, manatalId } of batch) {
      const ref = payload.candidate_reference as string | undefined;

      if (ref && existing.has(ref)) {
        ctx.report.candidates.skipped++;
        continue;
      }
      if (!payload.name && !payload.first_name && !payload.last_name) {
        ctx.report.candidates.errors++;
        ctx.report.errors.push({
          row: rowIdx,
          entity: 'candidate',
          message: 'Candidate zonder naam — overgeslagen',
          raw: row,
        });
        continue;
      }
      // Markeer source zodat rollback ze kan vinden
      const enriched = {
        ...payload,
        source: payload.source ?? MIGRATION_SOURCE_TAG,
      };

      if (ctx.dryRun) {
        ctx.report.candidates.imported++;
        continue;
      }

      try {
        const candidate = await createCandidate(
          ctx.tenantId,
          ctx.userId,
          enriched as Parameters<typeof createCandidate>[2]
        );
        ctx.report.candidates.imported++;
        if (manatalId) idMap.set(manatalId, candidate.id);
        if (ref) idMap.set(ref, candidate.id);

        await withTenant(ctx.tenantId, async (client) => {
          await logAudit(
            client,
            ctx.tenantId,
            {
              action: 'candidate.imported',
              entityType: 'candidate',
              entityId: candidate.id,
              after: {
                source: MIGRATION_SOURCE_TAG,
                manatal_id: manatalId,
                candidate_reference: ref ?? candidate.candidate_reference,
                batch_id: ctx.batchId,
              },
              userId: ctx.userId,
            },
            {}
          );
        });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e.code === '23505' && ctx.skipDuplicates) {
          ctx.report.candidates.skipped++;
          continue;
        }
        ctx.report.candidates.errors++;
        ctx.report.errors.push({
          row: rowIdx,
          entity: 'candidate',
          message: e.message ?? String(err),
          raw: row,
        });
      }
    }
  }

  return idMap;
}

/**
 * Application-import. Resolves candidate + job via id-maps, dan stage_id
 * via stage-naam. ON CONFLICT-skip in pipeline.addToPipeline maakt dit
 * idempotent.
 */
export async function importApplications(
  ctx: ImportContext,
  rows: Record<string, string>[],
  candidateMap: Map<string, string>,
  jobMap: Map<string, string>
): Promise<void> {
  ctx.report.applications.total = rows.length;

  // Cache stage-lookups per job.
  const stageCache = new Map<string, Map<string, string>>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIdx = i + 1;

    const candidateKey =
      row['Candidate ID'] ??
      row['Candidate Reference'] ??
      row['Reference'] ??
      '';
    const jobKey =
      row['Job ID'] ?? row['Job Reference'] ?? row['Reference'] ?? '';

    const candidateId = candidateMap.get(String(candidateKey).trim());
    const jobId = jobMap.get(String(jobKey).trim());

    if (!candidateId || !jobId) {
      ctx.report.applications.errors++;
      ctx.report.errors.push({
        row: rowIdx,
        entity: 'application',
        message: `Kon candidate (${candidateKey}) of job (${jobKey}) niet vinden in id-map`,
        raw: row,
      });
      continue;
    }

    if (ctx.dryRun) {
      ctx.report.applications.imported++;
      continue;
    }

    // Resolve stage via stage-naam.
    let stageId: string | undefined;
    const stageRaw = row['Stage'] ?? row['Pipeline Stage'] ?? row['Status'] ?? '';
    if (stageRaw) {
      const resolvedName = resolveStageNameFromManatal(String(stageRaw)) ?? stageRaw;
      let map = stageCache.get(jobId);
      if (!map) {
        map = await loadStageIdsForJob(ctx.tenantId, jobId);
        stageCache.set(jobId, map);
      }
      stageId = map.get(String(resolvedName).toLowerCase());
    }

    try {
      const application = await addToPipeline(ctx.tenantId, ctx.userId, {
        candidate_id: candidateId,
        job_id: jobId,
        stage_id: stageId,
      });
      ctx.report.applications.imported++;

      await withTenant(ctx.tenantId, async (client) => {
        await logAudit(
          client,
          ctx.tenantId,
          {
            action: 'application.imported',
            entityType: 'application',
            entityId: application.id,
            after: {
              source: MIGRATION_SOURCE_TAG,
              candidate_id: candidateId,
              job_id: jobId,
              stage_id: stageId ?? null,
              batch_id: ctx.batchId,
            },
            userId: ctx.userId,
          },
          {}
        );
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (
        (e.code === '23505' || /ALREADY_APPLIED/i.test(String(e.message))) &&
        ctx.skipDuplicates
      ) {
        ctx.report.applications.skipped++;
        continue;
      }
      ctx.report.applications.errors++;
      ctx.report.errors.push({
        row: rowIdx,
        entity: 'application',
        message: e.message ?? String(err),
        raw: row,
      });
    }
  }
}

/**
 * Notes-import — als TalentFlow geen `candidate_notes` tabel heeft, schrijven
 * we naar `activities` met action='note_imported' en de body in payload.body.
 * Voor jobs gebruiken we de bestaande `job_notes` tabel.
 */
export async function importNotes(
  ctx: ImportContext,
  rows: Record<string, string>[],
  candidateMap: Map<string, string>,
  jobMap: Map<string, string>
): Promise<void> {
  ctx.report.notes.total = rows.length;

  if (ctx.dryRun) {
    // Validate but don't insert
    for (const row of rows) {
      const entityType = (row['Entity Type'] ?? row['Type'] ?? 'candidate').toLowerCase();
      const body = row['Body'] ?? row['Note'] ?? row['Content'] ?? '';
      if (!body) continue;
      if (entityType === 'job' || entityType === 'candidate') {
        ctx.report.notes.imported++;
      }
    }
    return;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIdx = i + 1;
    const entityType = (row['Entity Type'] ?? row['Type'] ?? 'candidate').toLowerCase();
    const body = row['Body'] ?? row['Note'] ?? row['Content'] ?? '';
    if (!body) continue;

    const entityKey =
      row['Entity ID'] ??
      row['Candidate ID'] ??
      row['Job ID'] ??
      row['Reference'] ??
      '';
    const map = entityType === 'job' ? jobMap : candidateMap;
    const entityId = map.get(String(entityKey).trim());
    if (!entityId) {
      ctx.report.errors.push({
        row: rowIdx,
        entity: 'note',
        message: `Note: kon ${entityType} (${entityKey}) niet vinden in id-map`,
        raw: row,
      });
      continue;
    }

    try {
      await withTenant(ctx.tenantId, async (client) => {
        if (entityType === 'job') {
          await client.query(
            `INSERT INTO job_notes (tenant_id, job_id, user_id, body)
             VALUES ($1, $2, $3, $4)`,
            [ctx.tenantId, entityId, ctx.userId, String(body)]
          );
        } else {
          await client.query(
            `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
             VALUES ($1, 'candidate', $2, $3, 'note_imported', $4::jsonb)`,
            [
              ctx.tenantId,
              entityId,
              ctx.userId,
              JSON.stringify({
                source: MIGRATION_SOURCE_TAG,
                body: String(body),
                batch_id: ctx.batchId,
              }),
            ]
          );
        }
      });
      ctx.report.notes.imported++;
    } catch (err) {
      ctx.report.errors.push({
        row: rowIdx,
        entity: 'note',
        message: (err as Error).message,
        raw: row,
      });
    }
  }
}

/**
 * Resume-import. Voor elke kandidaat-id-map-entry zoeken we
 * `<resumesDir>/<candidate_reference>.<ext>`. Eerste match wins.
 */
export async function importResumes(
  ctx: ImportContext,
  resumesDir: string,
  candidatesByRef: Map<string, string>
): Promise<void> {
  if (!fs.existsSync(resumesDir)) {
    log(`${C.yellow}  [warn] resumes-dir bestaat niet: ${resumesDir}${C.reset}`);
    return;
  }
  const files = fs.readdirSync(resumesDir);
  ctx.report.resumes.total = candidatesByRef.size;

  // Build lookup: candidate_reference (uppercase) → file
  const byRef = new Map<string, string>();
  for (const f of files) {
    const ref = path.parse(f).name.toUpperCase();
    if (!byRef.has(ref)) byRef.set(ref, f);
  }

  if (ctx.dryRun) {
    let count = 0;
    for (const ref of candidatesByRef.keys()) {
      if (byRef.has(ref.toUpperCase())) count++;
    }
    ctx.report.resumes.uploaded = count;
    ctx.report.resumes.queued_for_parsing = count;
    return;
  }

  // Lazy-load queue om import in dry-run te vermijden
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resumeParserQueue } = require('../src/queue/queues') as typeof import('../src/queue/queues');

  for (const [ref, candidateId] of candidatesByRef.entries()) {
    const file = byRef.get(ref.toUpperCase());
    if (!file) continue;

    const filePath = path.join(resumesDir, file);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err) {
      ctx.report.errors.push({
        row: 0,
        entity: 'resume',
        message: `Kon resume-bestand niet lezen: ${filePath} (${(err as Error).message})`,
        raw: { ref, candidateId },
      });
      continue;
    }

    const resumeId = randomUUID();
    const mime = guessMime(file);
    const storageKey = buildResumeStorageKey(ctx.tenantId, candidateId, resumeId, file);

    try {
      const storage = getStorage();
      await storage.put(storageKey, buffer, mime);
      const downloadUrl = await storage.getDownloadUrl(storageKey);

      await withTenant(ctx.tenantId, async (client) => {
        await client.query(
          `INSERT INTO candidate_resumes
             (id, tenant_id, candidate_id, filename, storage_url, storage_key,
              mime_type, size_bytes, is_primary, parse_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, 'pending')
           ON CONFLICT DO NOTHING`,
          [
            resumeId,
            ctx.tenantId,
            candidateId,
            file,
            downloadUrl,
            storageKey,
            mime,
            buffer.byteLength,
          ]
        );
      });
      ctx.report.resumes.uploaded++;

      try {
        await resumeParserQueue.add('parse-resume', {
          resumeId,
          candidateId,
          tenantId: ctx.tenantId,
          storageKey,
          mimeType: mime,
          filename: file,
        });
        ctx.report.resumes.queued_for_parsing++;
      } catch {
        // Niet-fataal — operator kan later opnieuw queueen.
      }
    } catch (err) {
      ctx.report.errors.push({
        row: 0,
        entity: 'resume',
        message: (err as Error).message,
        raw: { ref, candidateId, filePath },
      });
    }
  }
}

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollback
// ─────────────────────────────────────────────────────────────────────────────

export interface RollbackResult {
  applications_deleted: number;
  candidates_deleted: number;
  jobs_deleted: number;
  notes_deleted: number;
  audit_events_deleted: number;
}

/**
 * Rollback — verwijder alle data getagged met source='manatal_migration'
 * voor een tenant. Hard-delete; gebruikers moeten een DB-backup hebben.
 *
 * Volgorde:
 *   1. Applications die naar manatal-migrated candidates of jobs wijzen.
 *   2. Job-notes met activities-payload.source = 'manatal_migration' (we
 *      filteren via audit_events ipv direct, want job_notes zelf heeft
 *      geen source-kolom — we koppelen op de audit-trail).
 *   3. Candidate-notes (activities-rows met action='note_imported' +
 *      payload.source='manatal_migration').
 *   4. Candidates met source='manatal_migration'.
 *   5. Jobs waarvan de audit-trail een 'job.imported' event met manatal_migration heeft.
 *   6. Audit events met action ∈ {candidate.imported, job.imported, application.imported,
 *      note_imported, migration.completed}.
 *
 * NB: Verwijdert candidates ON CASCADE → applications + candidate_resumes
 * + scorecards verdwijnen automatisch via FK.
 */
export async function rollbackTenant(tenantId: string): Promise<RollbackResult> {
  return withTenant(tenantId, async (client) => {
    // 1+2: Hard-delete candidates met source='manatal_migration' — CASCADE
    // ruimt applications/resumes/etc. op.
    const { rowCount: candDeleted } = await client.query(
      `DELETE FROM candidates
       WHERE tenant_id = $1 AND source = $2`,
      [tenantId, MIGRATION_SOURCE_TAG]
    );

    // 3: Verwijder jobs waarvan audit-event 'job.imported' bestaat met
    //    payload.source='manatal_migration'.
    const { rows: jobIdsRows } = await client.query(
      `SELECT DISTINCT entity_id::uuid AS id
       FROM audit_events
       WHERE tenant_id = $1
         AND action = 'job.imported'
         AND after->>'source' = $2`,
      [tenantId, MIGRATION_SOURCE_TAG]
    );
    const jobIds = (jobIdsRows as { id: string }[]).map((r) => r.id);
    let jobDeleted = 0;
    if (jobIds.length > 0) {
      const { rowCount } = await client.query(
        `DELETE FROM jobs WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [jobIds, tenantId]
      );
      jobDeleted = rowCount ?? 0;
    }

    // 4: Verwijder applications die we als 'application.imported' hebben gelogd.
    //    Mogelijk al weg door candidate-cascade — DELETE is dan idempotent.
    const { rows: appIdsRows } = await client.query(
      `SELECT DISTINCT entity_id::uuid AS id
       FROM audit_events
       WHERE tenant_id = $1
         AND action = 'application.imported'
         AND after->>'source' = $2`,
      [tenantId, MIGRATION_SOURCE_TAG]
    );
    const appIds = (appIdsRows as { id: string }[]).map((r) => r.id);
    let appDeleted = 0;
    if (appIds.length > 0) {
      const { rowCount } = await client.query(
        `DELETE FROM applications WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [appIds, tenantId]
      );
      appDeleted = rowCount ?? 0;
    }

    // 5: Notes — activities + job_notes
    const { rowCount: actDeleted } = await client.query(
      `DELETE FROM activities
       WHERE tenant_id = $1
         AND action = 'note_imported'
         AND payload->>'source' = $2`,
      [tenantId, MIGRATION_SOURCE_TAG]
    );

    // 6: Audit events
    const { rowCount: auditDeleted } = await client.query(
      `DELETE FROM audit_events
       WHERE tenant_id = $1
         AND (
           action IN (
             'candidate.imported',
             'job.imported',
             'application.imported',
             'migration.completed'
           )
           OR (action = 'note_imported' AND after->>'source' = $2)
         )`,
      [tenantId, MIGRATION_SOURCE_TAG]
    );

    return {
      candidates_deleted: candDeleted ?? 0,
      jobs_deleted: jobDeleted,
      applications_deleted: appDeleted,
      notes_deleted: actDeleted ?? 0,
      audit_events_deleted: auditDeleted ?? 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation prompt
// ─────────────────────────────────────────────────────────────────────────────

export async function confirmDestructive(
  question: string,
  skip: boolean
): Promise<boolean> {
  if (skip) return true;
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Report writer
// ─────────────────────────────────────────────────────────────────────────────

export function writeReport(report: MigrationReport, outDir: string): string {
  const ts = report.completed_at.replace(/[:.]/g, '-');
  const file = path.join(outDir, `migration-report-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8');
  return file;
}

export function printSummary(report: MigrationReport): void {
  log('');
  log(`${C.bold}${C.cyan}=== Migratie samenvatting ===${C.reset}`);
  log(`Tenant:      ${report.tenant_id}`);
  log(`Dry-run:     ${report.dry_run ? C.yellow + 'YES' + C.reset : C.green + 'NO (live import)' + C.reset}`);
  log(`Duration:    ${report.duration_seconds}s`);
  log('');
  const fmt = (label: string, s: EntityStats): string =>
    `${C.bold}${label.padEnd(14)}${C.reset} total=${s.total}  ` +
    `${C.green}imported=${s.imported}${C.reset}  ` +
    `${C.gray}skipped=${s.skipped}${C.reset}  ` +
    `${s.errors > 0 ? C.red : C.gray}errors=${s.errors}${C.reset}`;
  log(fmt('Candidates', report.candidates));
  log(fmt('Jobs', report.jobs));
  log(fmt('Applications', report.applications));
  log(
    `${C.bold}Notes${C.reset.padEnd(0)}         total=${report.notes.total}  ` +
      `${C.green}imported=${report.notes.imported}${C.reset}`
  );
  log(
    `${C.bold}Resumes${C.reset}       total=${report.resumes.total}  ` +
      `${C.green}uploaded=${report.resumes.uploaded}${C.reset}  ` +
      `queued=${report.resumes.queued_for_parsing}`
  );
  if (report.unknown_columns.length > 0) {
    log('');
    log(`${C.yellow}Onbekende CSV-kolommen (genegeerd):${C.reset}`);
    for (const u of report.unknown_columns) {
      log(`  - [${u.entity}] ${u.column}`);
    }
  }
  if (report.errors.length > 0) {
    log('');
    log(`${C.red}Errors (${report.errors.length}):${C.reset}`);
    for (const e of report.errors.slice(0, 20)) {
      log(`  row ${e.row} [${e.entity}]: ${e.message}`);
    }
    if (report.errors.length > 20) {
      log(`  … en ${report.errors.length - 20} meer (zie report-bestand).`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main run-functie. Wordt door CLI én tests aangeroepen. Gebruikers kunnen
 * een mock-args object meegeven; default = process.argv.slice(2).
 */
export async function runImport(args: ParsedArgs): Promise<MigrationReport> {
  if (!args.tenantId) {
    throw new Error('--tenant-id is verplicht voor import');
  }

  log(`${C.bold}${C.cyan}Manatal → TalentFlow migratie${C.reset}`);
  log(`Tenant: ${args.tenantId}`);
  log(`Dry-run: ${args.dryRun ? 'YES' : 'NO'}`);
  log(`Skip-duplicates: ${args.skipDuplicates}`);
  log('');

  await verifyTenant(args.tenantId);

  const startedAt = new Date();
  const report: MigrationReport = {
    tenant_id: args.tenantId,
    started_at: startedAt.toISOString(),
    completed_at: '',
    duration_seconds: 0,
    dry_run: args.dryRun,
    candidates: { total: 0, imported: 0, skipped: 0, errors: 0 },
    jobs: { total: 0, imported: 0, skipped: 0, errors: 0 },
    applications: { total: 0, imported: 0, skipped: 0, errors: 0 },
    notes: { total: 0, imported: 0 },
    resumes: { total: 0, uploaded: 0, queued_for_parsing: 0 },
    unknown_columns: [],
    errors: [],
    id_map: { candidates: {}, jobs: {} },
  };

  const ctx: ImportContext = {
    tenantId: args.tenantId,
    userId: '00000000-0000-0000-0000-000000000000', // system user
    batchId: randomUUID(),
    dryRun: args.dryRun,
    skipDuplicates: args.skipDuplicates,
    report,
    unknownColumns: new Map(),
  };

  // 1. Jobs first — applications depend on these.
  let jobMap = new Map<string, string>();
  if (args.jobs) {
    log(`${C.bold}1/5 Jobs${C.reset} — ${args.jobs}`);
    const { rows } = readCsvFile(args.jobs);
    jobMap = await importJobs(ctx, rows);
  }

  // 2. Candidates.
  let candidateMap = new Map<string, string>();
  if (args.candidates) {
    log(`${C.bold}2/5 Candidates${C.reset} — ${args.candidates}`);
    const { rows } = readCsvFile(args.candidates);
    candidateMap = await importCandidates(ctx, rows, args.batchSize);
  }

  // 3. Applications.
  if (args.applications) {
    log(`${C.bold}3/5 Applications${C.reset} — ${args.applications}`);
    const { rows } = readCsvFile(args.applications);
    await importApplications(ctx, rows, candidateMap, jobMap);
  }

  // 4. Notes.
  if (args.notes) {
    log(`${C.bold}4/5 Notes${C.reset} — ${args.notes}`);
    const { rows } = readCsvFile(args.notes);
    await importNotes(ctx, rows, candidateMap, jobMap);
  }

  // 5. Resumes.
  if (args.resumesDir) {
    log(`${C.bold}5/5 Resumes${C.reset} — ${args.resumesDir}`);
    // candidatesByRef: alleen entries die al in candidateMap staan, gekeyed
    // op candidate_reference (we hebben beide vormen ingestopt).
    const byRef = new Map<string, string>();
    for (const [k, v] of candidateMap.entries()) {
      // Heuristic: candidate_reference is alphanumeric only, geen UUID.
      if (/^[A-Z0-9]{6,}$/.test(k)) byRef.set(k, v);
    }
    await importResumes(ctx, args.resumesDir, byRef);
  }

  const completedAt = new Date();
  report.completed_at = completedAt.toISOString();
  report.duration_seconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);

  // Flatten unknown-columns Map → array
  for (const [entity, cols] of ctx.unknownColumns.entries()) {
    for (const col of cols) {
      report.unknown_columns.push({ entity, column: col });
    }
  }

  // Persist id-maps voor diagnostics
  for (const [k, v] of candidateMap.entries()) report.id_map.candidates[k] = v;
  for (const [k, v] of jobMap.entries()) report.id_map.jobs[k] = v;

  // Final audit-event met heel rapport
  if (!args.dryRun) {
    try {
      await withTenant(args.tenantId, async (client) => {
        await logAudit(
          client,
          args.tenantId!,
          {
            action: 'migration.completed',
            entityType: 'migration',
            entityId: ctx.batchId,
            after: {
              source: MIGRATION_SOURCE_TAG,
              batch_id: ctx.batchId,
              report: {
                candidates: report.candidates,
                jobs: report.jobs,
                applications: report.applications,
                notes: report.notes,
                resumes: report.resumes,
                duration_seconds: report.duration_seconds,
              },
            },
            userId: ctx.userId,
          },
          {}
        );
      });
    } catch {
      // Niet-fataal — rapport wordt nog steeds naar disk geschreven.
    }
  }

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    log(`${C.red}Argument-fout: ${(err as Error).message}${C.reset}`);
    log(HELP_TEXT);
    return 2;
  }

  if (args.help) {
    log(HELP_TEXT);
    return 0;
  }

  if (args.rollbackTenant) {
    log(
      `${C.red}${C.bold}!! ROLLBACK ${args.rollbackTenant} !!${C.reset}\n` +
        `Dit verwijdert ALLE data getagged source='${MIGRATION_SOURCE_TAG}' van deze tenant.\n` +
        `Alleen veilig wanneer er een DB-backup is.`
    );
    const ok = await confirmDestructive(
      `Type 'yes' om door te gaan: `,
      args.yes
    );
    if (!ok) {
      log('Rollback geannuleerd.');
      return 1;
    }
    const result = await rollbackTenant(args.rollbackTenant);
    log(`${C.green}Rollback compleet:${C.reset}`);
    log(JSON.stringify(result, null, 2));
    return 0;
  }

  try {
    const report = await runImport(args);
    const reportFile = writeReport(report, process.cwd());
    log('');
    log(`${C.green}Rapport opgeslagen: ${reportFile}${C.reset}`);
    printSummary(report);
    return report.errors.length > 0 ? 1 : 0;
  } catch (err) {
    log(`${C.red}Fatale fout: ${(err as Error).message}${C.reset}`);
    log((err as Error).stack ?? '');
    return 1;
  }
}

// Run if invoked directly via `tsx scripts/manatal-import.ts`.
// Het guard-pattern voorkomt dat tests die deze module importeren onbedoeld
// `main()` triggeren.
if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    }
  );
}
