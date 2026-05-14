/**
 * Resume parser worker — Slice 2.
 *
 * Pipeline:
 *   1. Markeer candidate_resumes.parse_status = 'processing'
 *   2. Download bestand via storage abstractie
 *   3. Extract tekst (pdf-parse voor PDF, mammoth voor DOCX)
 *   4. Persist parsed_text op candidate_resumes
 *   5. Roep parseResumeWithAI(text) aan
 *   6. In één transactie: vervang ai_extracted skills, update samenvatting +
 *      kandidaatvelden, schrijf activity-log
 *   7. Bij fouten: parse_status='failed' + parse_error, en re-throw zodat
 *      BullMQ de retry kan beheren
 *
 * RLS-context wordt via SET LOCAL ingesteld op de transactie zodat
 * tenant-isolatie ook in de worker afgedwongen wordt.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { getStorage } from '../../lib/storage';
import { parseResumeWithAI, type ParsedResume } from '../../lib/aiParser';
import { logAIEvent } from '../../lib/aiEvents';
import { queueEmbedding } from '../../modules/matching/matchingEmitter';

// ─────────────────────────────────────────────────────────────────────────────
// Job contract (door Agent J vastgesteld — niet wijzigen)
// ─────────────────────────────────────────────────────────────────────────────

interface ResumeParserJobData {
  resumeId: string;
  candidateId: string;
  tenantId: string;
  storageKey: string;
  mimeType: string;
  filename: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';

const PARSE_ERROR_MAX_LEN = 500;

// ─────────────────────────────────────────────────────────────────────────────
// RLS helpers (worker-lokaal — we delen niet `withTenant` om de import-cycle
// met candidates.service.ts te vermijden, maar volgen identiek patroon)
// ─────────────────────────────────────────────────────────────────────────────

async function withTenantTx<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error('Invalid tenant_id format');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Standalone status-update zónder bredere transactie. Gebruikt voor de
 * "processing" en "failed" markers — die mogen onafhankelijk van de
 * hoofd-transactie committen, anders verlies je de status bij een rollback.
 */
async function updateParseStatus(
  tenantId: string,
  resumeId: string,
  status: 'processing' | 'failed',
  error?: string
): Promise<void> {
  if (!UUID_REGEX.test(tenantId)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    if (status === 'failed') {
      await client.query(
        `UPDATE candidate_resumes
         SET parse_status = $1, parse_error = $2
         WHERE id = $3 AND tenant_id = $4`,
        [status, (error ?? '').slice(0, PARSE_ERROR_MAX_LEN), resumeId, tenantId]
      );
    } else {
      await client.query(
        `UPDATE candidate_resumes
         SET parse_status = $1, parse_error = NULL
         WHERE id = $2 AND tenant_id = $3`,
        [status, resumeId, tenantId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[resumeParser] failed to update parse_status', {
      resumeId,
      status,
      error: (err as Error).message,
    });
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream → Buffer
// ─────────────────────────────────────────────────────────────────────────────

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === 'string') {
      // Defensief: sommige streams zijn in object-mode of ascii-mode geconfigureerd.
      chunks.push(Buffer.from(chunk, 'utf8'));
    } else {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
  }
  return Buffer.concat(chunks);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tekst-extractie
// ─────────────────────────────────────────────────────────────────────────────

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse') as (
    buffer: Buffer
  ) => Promise<{ text: string }>;
  const data = await pdfParse(buffer);
  return data.text ?? '';
}

/**
 * mammoth's officiele API accepteert `path` of `buffer`. We schrijven naar
 * een tijdelijke file om volledig cross-platform te zijn (Windows lockt
 * NodeJS-buffers soms anders dan Linux); dat is veiliger dan vertrouwen op
 * de buffer-API.
 */
async function extractTextFromDocx(
  buffer: Buffer,
  filename: string
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mammoth = require('mammoth') as {
    extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
  };

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const tempPath = path.join(
    os.tmpdir(),
    `tf-resume-${randomUUID()}-${safeName || 'cv.docx'}`
  );

  fs.writeFileSync(tempPath, buffer);
  try {
    const result = await mammoth.extractRawText({ path: tempPath });
    return result.value ?? '';
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch (err) {
      logger.warn('[resumeParser] failed to unlink temp docx', {
        tempPath,
        error: (err as Error).message,
      });
    }
  }
}

async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  if (mimeType === PDF_MIME) {
    return extractTextFromPdf(buffer);
  }
  if (mimeType === DOCX_MIME || mimeType === DOC_MIME) {
    return extractTextFromDocx(buffer, filename);
  }
  // Best-effort: probeer als plain-text in te lezen voor TXT/MD/RTF.
  if (mimeType.startsWith('text/')) {
    return buffer.toString('utf8');
  }
  throw new Error(`Onbekend MIME-type voor CV-parsing: ${mimeType}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache van bestaande optionele kolommen op `candidates`. We checken dit éénmaal
 * tijdens de eerste worker-run zodat we niet bij elk verwerkt CV een
 * information_schema-query doen, maar wel netjes degraderen als de migratie
 * er nog niet is.
 */
let optionalColumnsCache: { current_position: boolean; current_company: boolean } | null =
  null;

async function ensureOptionalColumnsKnown(client: PoolClient): Promise<void> {
  if (optionalColumnsCache) return;
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'candidates'
       AND column_name IN ('current_position', 'current_company')`
  );
  const set = new Set(rows.map((r) => r.column_name));
  optionalColumnsCache = {
    current_position: set.has('current_position'),
    current_company: set.has('current_company'),
  };
  if (!optionalColumnsCache.current_position || !optionalColumnsCache.current_company) {
    logger.info('[resumeParser] candidates table mist current_position/current_company kolommen — overslaan in update', optionalColumnsCache);
  }
}

async function persistParsedText(
  client: PoolClient,
  resumeId: string,
  tenantId: string,
  parsedText: string
): Promise<void> {
  await client.query(
    `UPDATE candidate_resumes
     SET parsed_text = $1
     WHERE id = $2 AND tenant_id = $3`,
    [parsedText, resumeId, tenantId]
  );
}

async function applyParsedResume(
  client: PoolClient,
  data: ResumeParserJobData,
  parsed: ParsedResume,
  parsedText: string
): Promise<void> {
  const { resumeId, candidateId, tenantId } = data;

  // 1) AI-skills opnieuw zetten — verwijder oude ai_extracted, insert nieuwe
  await client.query(
    `DELETE FROM candidate_skills
     WHERE candidate_id = $1 AND tenant_id = $2 AND source = 'ai_extracted'`,
    [candidateId, tenantId]
  );

  if (parsed.skills.length > 0) {
    // ON CONFLICT op de unieke (candidate_id, lower(skill))-index om botsing
    // met eventuele 'manual' rijen netjes af te vangen — dan slaan we de
    // ai_extracted versie over zodat handmatig ingevoerde scores winnen.
    for (const item of parsed.skills) {
      await client.query(
        `INSERT INTO candidate_skills (tenant_id, candidate_id, skill, score, source)
         VALUES ($1, $2, $3, $4, 'ai_extracted')
         ON CONFLICT (candidate_id, lower(skill)) DO NOTHING`,
        [tenantId, candidateId, item.skill, item.score]
      );
    }
  }

  // 2) candidate_resumes: samenvatting + status
  await client.query(
    `UPDATE candidate_resumes
     SET ai_summary = $1,
         parsed_text = COALESCE(parsed_text, $2),
         parse_status = 'done',
         parse_error = NULL,
         parsed_at = now()
     WHERE id = $3 AND tenant_id = $4`,
    [parsed.summary, parsedText, resumeId, tenantId]
  );

  // 3) candidates: alleen NULL-velden overschrijven, languages mergen,
  //    skills (text[]) syncen met laatste AI-namen.
  await ensureOptionalColumnsKnown(client);

  const skillNames = parsed.skills.map((s) => s.skill);

  // Bouw UPDATE dynamisch met SET-fragmenten zodat we missing kolommen overslaan.
  const fragments: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  fragments.push(
    `years_of_experience = COALESCE(years_of_experience, $${idx++})`
  );
  values.push(parsed.years_of_experience);

  if (optionalColumnsCache?.current_position) {
    fragments.push(`current_position = COALESCE(current_position, $${idx++})`);
    values.push(parsed.current_position);
  }
  if (optionalColumnsCache?.current_company) {
    fragments.push(`current_company = COALESCE(current_company, $${idx++})`);
    values.push(parsed.current_company);
  }

  // languages: merge bestaande array met nieuwe, dedupe (case-insensitive),
  // behoud volgorde van bestaande items vóór nieuwe.
  fragments.push(`languages = (
    SELECT COALESCE(array_agg(DISTINCT lang), ARRAY[]::text[])
    FROM (
      SELECT unnest(COALESCE(languages, ARRAY[]::text[])) AS lang
      UNION
      SELECT unnest($${idx++}::text[]) AS lang
    ) merged
    WHERE lang IS NOT NULL AND length(trim(lang)) > 0
  )`);
  values.push(parsed.languages);

  // skills (text[]): we vervangen door de AI-namen — dit is de "authoritative"
  // weergave gebaseerd op de meest recente parse. Manual skills blijven
  // bewaard in candidate_skills; de text[]-kolom is primair een zoek-index.
  fragments.push(`skills = $${idx++}::text[]`);
  values.push(skillNames);

  fragments.push(`updated_at = now()`);

  values.push(candidateId, tenantId);
  const sql = `UPDATE candidates
               SET ${fragments.join(', ')}
               WHERE id = $${idx++} AND tenant_id = $${idx}`;
  await client.query(sql, values);

  // 4) Activity log
  await client.query(
    `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
     VALUES ($1, 'candidate', $2, NULL, 'resume_parsed', $3)`,
    [
      tenantId,
      candidateId,
      JSON.stringify({
        resumeId,
        skill_count: parsed.skills.length,
        years_of_experience: parsed.years_of_experience,
      }),
    ]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

async function processResumeJob(job: Job<ResumeParserJobData>): Promise<void> {
  const data = job.data;

  // Defensieve type-check: legacy queue-items van vóór Slice 2 hebben mogelijk
  // {filePath} ipv {storageKey,resumeId}. Die kunnen we niet verwerken.
  if (!data.resumeId || !data.storageKey) {
    logger.error('[resumeParser] legacy job-payload zonder resumeId/storageKey — drop', {
      jobId: job.id,
      keys: Object.keys(data ?? {}),
    });
    return;
  }

  logger.info('[resumeParser] start', {
    jobId: job.id,
    resumeId: data.resumeId,
    candidateId: data.candidateId,
    storageKey: data.storageKey,
  });

  await updateParseStatus(data.tenantId, data.resumeId, 'processing');

  try {
    // 1) Download via storage abstractie
    const stream = await getStorage().getStream(data.storageKey);
    const buffer = await streamToBuffer(stream);

    if (buffer.length === 0) {
      throw new Error('Bestand is leeg (0 bytes)');
    }

    // 2) Tekst-extractie
    const resumeText = await extractText(buffer, data.mimeType, data.filename);
    if (!resumeText.trim()) {
      throw new Error('Geen tekst geëxtraheerd uit bestand');
    }

    // 3) Persist parsed_text vroeg, zodat zoeken/diagnostiek werkt zelfs als
    //    de AI-call later faalt.
    await withTenantTx(data.tenantId, async (client) => {
      await persistParsedText(client, data.resumeId, data.tenantId, resumeText);
    });

    // 4) AI-parse (kan lang duren — buiten transactie houden). De parser
    //    levert `_meta` met latency / token-info zodat we dit feitelijk
    //    kunnen loggen naar ai_events i.p.v. te raden.
    const aiStartedAt = Date.now();
    let parsed: ParsedResume;
    try {
      parsed = await parseResumeWithAI(resumeText);
    } catch (aiErr) {
      // AI-call faalde: log een failed-row en re-throw zodat BullMQ retry doet.
      void logAIEvent(data.tenantId, {
        feature: 'resume_parser',
        model: 'claude-opus-4-7',
        provider: 'anthropic',
        input: resumeText.slice(0, 4000),
        latencyMs: Date.now() - aiStartedAt,
        entityType: 'candidate',
        entityId: data.candidateId,
        status: 'failed',
        error: (aiErr as Error).message?.slice(0, 1000) ?? 'unknown',
      });
      throw aiErr;
    }

    // Best-effort ai_events log — non-blocking, swallows errors zelf.
    void logAIEvent(data.tenantId, {
      feature: 'resume_parser',
      model: parsed._meta?.model ?? 'claude-opus-4-7',
      provider: 'anthropic',
      input: resumeText.slice(0, 4000),
      inputTokens: parsed._meta?.inputTokens,
      outputTokens: parsed._meta?.outputTokens,
      outputSummary: parsed.summary,
      latencyMs: parsed._meta?.latencyMs ?? Date.now() - aiStartedAt,
      entityType: 'candidate',
      entityId: data.candidateId,
      status: parsed._meta?.mocked ? 'mocked' : 'success',
    });

    // 5) Schrijf alle resultaten in één RLS-veilige transactie
    await withTenantTx(data.tenantId, async (client) => {
      await applyParsedResume(client, data, parsed, resumeText);
    });

    // 6) Slice 4: nu ai_summary + skills + current_position bijgewerkt zijn,
    //    queueen we de embedding-(re)generatie. NA de commit zodat de
    //    embedding-worker een verse candidate-rij leest.
    await queueEmbedding(data.tenantId, 'candidate', data.candidateId);

    logger.info('[resumeParser] done', {
      jobId: job.id,
      resumeId: data.resumeId,
      candidateId: data.candidateId,
      skill_count: parsed.skills.length,
    });
  } catch (err) {
    const message = (err as Error).message ?? 'onbekende fout';
    logger.error('[resumeParser] failed', {
      jobId: job.id,
      resumeId: data.resumeId,
      candidateId: data.candidateId,
      error: message,
    });
    await updateParseStatus(data.tenantId, data.resumeId, 'failed', message);
    throw err; // BullMQ retry-laag
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker setup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DISABLE_INLINE_WORKERS guard (Q1.2 follow-up).
 *
 * In productie draaien we de API en workers in losse containers (`api` vs
 * `api-worker`). De API mag dan GEEN workers starten, anders krijgen we
 * dubbele consumers per queue. We detecteren via twee env-vars:
 *
 *   WORKER_PROCESS=1            → gezet door queue/workers/index.ts (workers
 *                                 ALTIJD starten in dat proces).
 *   DISABLE_INLINE_WORKERS=true → gezet op de api-service in
 *                                 docker-compose.prod.yml (workers NIET
 *                                 starten in dat proces).
 *
 * Lokaal dev: beide env-vars leeg → workers starten inline (default gedrag).
 */
const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let resumeParserWorker: Worker<ResumeParserJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[resumeParser] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn(
      '[resumeParser] ANTHROPIC_API_KEY ontbreekt — worker draait met dev mock-parser. ' +
        'Configureer de key vóór je naar productie gaat.'
    );
  }

  resumeParserWorker = new Worker<ResumeParserJobData>(
    'resume-parser',
    processResumeJob,
    { connection }
  );

  resumeParserWorker.on('completed', (job) => {
    logger.info('[resumeParser] Job completed', { jobId: job.id });
  });

  resumeParserWorker.on('failed', (job, err) => {
    logger.error('[resumeParser] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
}

export { resumeParserWorker };
