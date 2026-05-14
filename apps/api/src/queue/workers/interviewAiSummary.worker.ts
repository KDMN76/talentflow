/**
 * Interview AI-summary worker — Sprint Q3.4 (Agent CCC).
 *
 * Pipeline:
 *   1. Lees recording-rij (verwacht transcript_text gevuld).
 *   2. Verzamel context: jobtitel, kandidaatnaam, eventuele kit-questions.
 *   3. Vraag Claude een gestructureerde samenvatting:
 *        { summary, strengths, concerns, recommendation }
 *   4. UPDATE recording → ai_summary, ai_strengths, ai_concerns,
 *      ai_recommendation, ai_status='done'.
 *
 * Logt elke call via `ai_events` (feature='interview_summary').
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { withTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { logAIEvent } from '../../lib/aiEvents';
import {
  getRecordingForWorker,
  setAiStatus,
  applyAiSummary,
  type AiRecommendation,
} from '../../modules/interviews/recordings.service';

interface InterviewAiSummaryJobData {
  recordingId: string;
  tenantId: string;
}

const PRIMARY_MODEL = 'claude-opus-4-7';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TRANSCRIPT_CHARS = 18_000;
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = [
  'Je bent een Nederlandstalige recruitment-AI die een sollicitatiegesprek analyseert.',
  'Je krijgt een transcript en optionele context. Lever een neutrale, feitelijke samenvatting.',
  'Vermijd discriminatoire taal (geslacht, leeftijd, herkomst, religie) — focus op skills, gedrag en geschiktheid.',
  '',
  'STRIKT OUTPUT-FORMAAT:',
  '- Antwoord UITSLUITEND met een geldig JSON-object — geen begeleidende tekst.',
  '- GEEN markdown-fences, GEEN uitleg, GEEN voor- of nawoord.',
  '- Het JSON-object moet exact deze keys hebben: summary, strengths, concerns, recommendation.',
  '',
  'VELD-INSTRUCTIES:',
  '- summary: exact 3 Nederlandstalige zinnen die het gesprek kort samenvatten.',
  '- strengths: array van 3-5 sterke punten (1 zin elk, NL).',
  '- concerns: array van 0-3 zorgpunten of open vragen (1 zin elk, NL).',
  '- recommendation: één van "strong_yes", "yes", "neutral", "no", "strong_no".',
].join('\n');

const summarySchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  strengths: z.array(z.string().trim().min(1).max(400)).min(0).max(10).default([]),
  concerns: z.array(z.string().trim().min(1).max(400)).min(0).max(10).default([]),
  recommendation: z.enum(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']),
});

type ParsedSummary = z.infer<typeof summarySchema>;

// ────────────────────────────────────────────────────────────────────────────
// Anthropic-client (lazy singleton, identiek aan aiParser.ts)
// ────────────────────────────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null;
let warnedAboutMissingKey = false;

function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY ontbreekt');
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

function shouldUseMockFallback(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (!warnedAboutMissingKey) {
    logger.warn(
      '[interviewAiSummary] ANTHROPIC_API_KEY ontbreekt — dev-fallback met mock-summary actief'
    );
    warnedAboutMissingKey = true;
  }
  return true;
}

function buildMockSummary(transcript: string): ParsedSummary {
  const preview = transcript.replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    summary: [
      'Mock-samenvatting: deze analyse is gegenereerd zonder AI omdat ANTHROPIC_API_KEY ontbreekt.',
      `Transcript-fragment: ${preview || '(leeg)'}.`,
      'Plausibele dummy-data; configureer een API key voor echte analyse.',
    ].join(' '),
    strengths: [
      'Heldere communicatie van eerdere ervaring.',
      'Concrete voorbeelden van technische keuzes.',
      'Duidelijke motivatie voor de rol.',
    ],
    concerns: ['Beperkt zicht op leiderschapsstijl onder druk.'],
    recommendation: 'neutral',
  };
}

function getResponseText(message: Anthropic.Messages.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(
      `interviewAiSummary: geen JSON gevonden (preview: ${raw.slice(0, 300)})`
    );
  }
  return JSON.parse(raw.slice(first, last + 1));
}

function isTransientApiError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number };
  const status = e?.status ?? e?.statusCode;
  return status === 429 || status === 500 || status === 502 || status === 503;
}

// ────────────────────────────────────────────────────────────────────────────
// Context-loader: jobtitel + kandidaatnaam (tenant-isolated)
// ────────────────────────────────────────────────────────────────────────────

interface InterviewContext {
  jobTitle: string | null;
  candidateName: string | null;
  kitQuestions: string[];
}

async function loadContext(
  tenantId: string,
  interviewId: string
): Promise<InterviewContext> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      job_title: string | null;
      first_name: string | null;
      last_name: string | null;
      candidate_name: string | null;
      kit_questions: unknown;
    }>(
      `SELECT
         j.title                            AS job_title,
         c.first_name                       AS first_name,
         c.last_name                        AS last_name,
         c.name                             AS candidate_name,
         ik.questions                       AS kit_questions
       FROM interviews i
       JOIN applications a ON a.id = i.application_id AND a.tenant_id = i.tenant_id
       LEFT JOIN jobs j       ON j.id = a.job_id       AND j.tenant_id = i.tenant_id
       LEFT JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = i.tenant_id
       LEFT JOIN interview_kits ik ON ik.id = i.interview_kit_id AND ik.tenant_id = i.tenant_id
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [interviewId, tenantId]
    );
    if (rows.length === 0) {
      return { jobTitle: null, candidateName: null, kitQuestions: [] };
    }
    const row = rows[0]!;
    const fullName =
      [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
      || row.candidate_name
      || null;
    let questions: string[] = [];
    if (Array.isArray(row.kit_questions)) {
      questions = (row.kit_questions as Array<{ text?: string }>)
        .map((q) => q?.text)
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .slice(0, 10);
    }
    return {
      jobTitle: row.job_title,
      candidateName: fullName,
      kitQuestions: questions,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Job processor
// ────────────────────────────────────────────────────────────────────────────

async function processSummaryJob(
  job: Job<InterviewAiSummaryJobData>
): Promise<void> {
  const { recordingId, tenantId } = job.data ?? {};
  if (!recordingId || !tenantId) {
    logger.error('[interviewAiSummary] invalide job-payload — drop', {
      jobId: job.id,
      data: job.data,
    });
    return;
  }

  const rec = await getRecordingForWorker(tenantId, recordingId);
  if (!rec) {
    logger.warn('[interviewAiSummary] recording niet gevonden — skip', {
      recordingId,
    });
    return;
  }
  if (!rec.transcript_text || rec.transcript_text.trim().length === 0) {
    logger.warn('[interviewAiSummary] geen transcript — skip', { recordingId });
    await setAiStatus(tenantId, recordingId, 'skipped');
    return;
  }
  if (rec.ai_status === 'done') {
    logger.info('[interviewAiSummary] al verwerkt — skip', { recordingId });
    return;
  }

  await setAiStatus(tenantId, recordingId, 'processing');

  const context = await loadContext(tenantId, rec.interview_id);
  const startedAt = Date.now();
  let parsed: ParsedSummary;
  let modelUsed = PRIMARY_MODEL;
  let mocked = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  try {
    if (shouldUseMockFallback()) {
      parsed = buildMockSummary(rec.transcript_text);
      mocked = true;
      modelUsed = `${PRIMARY_MODEL}-mock`;
    } else {
      const transcriptSafe = rec.transcript_text.slice(0, MAX_TRANSCRIPT_CHARS);
      const userPrompt = [
        context.jobTitle ? `Functietitel: ${context.jobTitle}` : null,
        context.candidateName ? `Kandidaat: ${context.candidateName}` : null,
        context.kitQuestions.length > 0
          ? `Verwachte vragen:\n- ${context.kitQuestions.join('\n- ')}`
          : null,
        '',
        'Hieronder volgt het transcript van het sollicitatiegesprek. Analyseer en retourneer JSON volgens het schema.',
        '',
        '--- BEGIN TRANSCRIPT ---',
        transcriptSafe,
        '--- EINDE TRANSCRIPT ---',
      ]
        .filter(Boolean)
        .join('\n');

      const client = getAnthropicClient();
      const callModel = (model: string) =>
        client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        });

      let response: Anthropic.Messages.Message;
      try {
        response = await callModel(PRIMARY_MODEL);
      } catch (err) {
        if (!isTransientApiError(err)) throw err;
        logger.warn('[interviewAiSummary] primary faalde — fallback model', {
          error: (err as Error).message,
        });
        response = await callModel(FALLBACK_MODEL);
        modelUsed = FALLBACK_MODEL;
      }

      const rawText = getResponseText(response);
      if (!rawText) {
        throw new Error('Lege respons van Claude (geen text-block)');
      }
      const json = extractJson(rawText);
      parsed = summarySchema.parse(json);
      inputTokens = response.usage?.input_tokens;
      outputTokens = response.usage?.output_tokens;
    }

    // Persist.
    await applyAiSummary(tenantId, recordingId, {
      summary: parsed.summary,
      strengths: parsed.strengths,
      concerns: parsed.concerns,
      recommendation: parsed.recommendation as AiRecommendation,
    });

    void logAIEvent(tenantId, {
      feature: 'interview_summary',
      model: modelUsed,
      provider: 'anthropic',
      input: rec.transcript_text.slice(0, 4000),
      inputTokens,
      outputTokens,
      outputSummary: parsed.summary,
      latencyMs: Date.now() - startedAt,
      entityType: 'interview_recording',
      entityId: recordingId,
      status: mocked ? 'mocked' : 'success',
    });

    logger.info('[interviewAiSummary] done', {
      jobId: job.id,
      recordingId,
      model: modelUsed,
      mocked,
      recommendation: parsed.recommendation,
    });
  } catch (err) {
    const message = (err as Error).message ?? 'onbekende fout';
    logger.error('[interviewAiSummary] failed', {
      jobId: job.id,
      recordingId,
      error: message,
    });

    void logAIEvent(tenantId, {
      feature: 'interview_summary',
      model: modelUsed,
      provider: 'anthropic',
      input: rec.transcript_text?.slice(0, 4000) ?? '',
      latencyMs: Date.now() - startedAt,
      entityType: 'interview_recording',
      entityId: recordingId,
      status: 'failed',
      error: message.slice(0, 1000),
    });

    await setAiStatus(tenantId, recordingId, 'failed');
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Worker setup
// ────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let interviewAiSummaryWorker: Worker<InterviewAiSummaryJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[interviewAiSummary] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn(
      '[interviewAiSummary] ANTHROPIC_API_KEY ontbreekt — worker draait met mock-summary. ' +
        'Configureer de key vóór productie.'
    );
  }

  interviewAiSummaryWorker = new Worker<InterviewAiSummaryJobData>(
    'interview-ai-summary',
    processSummaryJob,
    { connection, concurrency: 2 }
  );

  interviewAiSummaryWorker.on('completed', (job) => {
    logger.info('[interviewAiSummary] Job completed', { jobId: job.id });
  });

  interviewAiSummaryWorker.on('failed', (job, err) => {
    logger.error('[interviewAiSummary] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
}

export { interviewAiSummaryWorker };
