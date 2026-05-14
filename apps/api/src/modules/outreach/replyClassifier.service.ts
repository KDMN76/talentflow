/**
 * Reply classifier — Sprint Q4.5 (Agent XXX).
 *
 * Classifies inbound `outreach_messages.direction='inbound'` rows into one of
 * eight categories with a confidence score. In production it calls Claude with
 * a structured-output prompt; in mock-mode it falls back to a keyword heuristic
 * that is deterministic and good enough for tests + dev.
 *
 * applyNextAction translates the classification's `next_action` into a
 * concrete side-effect: schedule_call → tasks row, send_followup → enroll in
 * default follow-up sequence, pause_sequence → pause enrollment,
 * remove_from_outreach → stop enrollment + tag candidate `do_not_contact`,
 * manual_review → no-op (surfaces in inbox).
 */

import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit } from '../../lib/audit';
import { logAIEvent } from '../../lib/aiEvents';
import {
  pauseEnrollment as nurturePause,
  stopEnrollment as nurtureStop,
  enrollCandidate as nurtureEnroll,
} from '../nurture/nurture.service';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type ReplyCategory =
  | 'interested'
  | 'not_now'
  | 'not_interested'
  | 'out_of_office'
  | 'unsubscribe'
  | 'spam'
  | 'question'
  | 'unknown';

export type ReplySentiment = 'positive' | 'neutral' | 'negative' | 'mixed';

export type ReplyNextAction =
  | 'schedule_call'
  | 'send_followup'
  | 'pause_sequence'
  | 'remove_from_outreach'
  | 'manual_review';

export interface ClassificationRow {
  id: string;
  tenant_id: string;
  message_id: string;
  category: ReplyCategory;
  sentiment: ReplySentiment;
  next_action: ReplyNextAction;
  reasoning: string | null;
  confidence: number | null;
  ai_model: string | null;
  classified_at: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Heuristic classifier — fallback + mock-mode
// ───────────────────────────────────────────────────────────────────────────

interface HeuristicMatch {
  category: ReplyCategory;
  sentiment: ReplySentiment;
  next_action: ReplyNextAction;
  confidence: number;
}

const HEURISTICS: Array<{ regex: RegExp; match: HeuristicMatch; reason: string }> = [
  {
    regex: /\b(unsubscribe|uitschrijven|opt[\s-]?out|stop\s+sending|verwijder\s+mij)\b/i,
    match: {
      category: 'unsubscribe',
      sentiment: 'negative',
      next_action: 'remove_from_outreach',
      confidence: 0.95,
    },
    reason: 'Reply contains an opt-out / unsubscribe phrase.',
  },
  {
    regex: /\b(out\s+of\s+office|ooo|afwezig|met\s+vakantie|vacation\s+reply|automatic\s+reply)\b/i,
    match: {
      category: 'out_of_office',
      sentiment: 'neutral',
      next_action: 'pause_sequence',
      confidence: 0.92,
    },
    reason: 'Auto-reply / OOO indicator detected.',
  },
  {
    regex: /\b(not\s+interested|no\s+thanks|geen\s+interesse|niet\s+geinteresseerd|nee\s+bedankt)\b/i,
    match: {
      category: 'not_interested',
      sentiment: 'negative',
      next_action: 'remove_from_outreach',
      confidence: 0.9,
    },
    reason: 'Explicit rejection language detected.',
  },
  {
    regex: /\b(spam|phishing|scam)\b/i,
    match: {
      category: 'spam',
      sentiment: 'negative',
      next_action: 'remove_from_outreach',
      confidence: 0.97,
    },
    reason: 'Reply flagged as spam.',
  },
  {
    regex: /\b(later|misschien\s+later|niet\s+nu|not\s+now|in\s+a\s+few\s+months|q\d|next\s+quarter)\b/i,
    match: {
      category: 'not_now',
      sentiment: 'neutral',
      next_action: 'pause_sequence',
      confidence: 0.85,
    },
    reason: 'Time-deferred reply ("later" / "not now").',
  },
  {
    regex: /\b(interested|tell\s+me\s+more|interesse|graag|laten\s+we\s+praten|let'?s\s+talk|sounds\s+good|happy\s+to\s+chat)\b/i,
    match: {
      category: 'interested',
      sentiment: 'positive',
      next_action: 'schedule_call',
      confidence: 0.9,
    },
    reason: 'Affirmative interest signal detected.',
  },
  {
    regex: /\?|hoeveel|waarom|where|when|how\s+much|kunnen\s+we|kunt\s+u/i,
    match: {
      category: 'question',
      sentiment: 'neutral',
      next_action: 'manual_review',
      confidence: 0.7,
    },
    reason: 'Reply contains a question — needs human review.',
  },
];

export interface HeuristicResult {
  category: ReplyCategory;
  sentiment: ReplySentiment;
  next_action: ReplyNextAction;
  confidence: number;
  reasoning: string;
}

export function classifyByHeuristic(text: string): HeuristicResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return {
      category: 'unknown',
      sentiment: 'neutral',
      next_action: 'manual_review',
      confidence: 0.4,
      reasoning: 'Empty reply — escalate to manual review.',
    };
  }
  for (const h of HEURISTICS) {
    if (h.regex.test(trimmed)) {
      return {
        ...h.match,
        reasoning: h.reason,
      };
    }
  }
  return {
    category: 'unknown',
    sentiment: 'neutral',
    next_action: 'manual_review',
    confidence: 0.45,
    reasoning: 'No clear classification signal — needs human review.',
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Claude path
// ───────────────────────────────────────────────────────────────────────────

const CLASSIFIER_MODEL = process.env.OUTREACH_CLASSIFIER_MODEL ?? 'claude-haiku-4-5-20251001';

let cachedClient: unknown = null;
type AnthropicMessage = {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
type AnthropicLike = {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: string; content: string }>;
    }) => Promise<AnthropicMessage>;
  };
};

async function getClient(): Promise<AnthropicLike> {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ontbreekt');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient as AnthropicLike;
}

function shouldUseMock(): boolean {
  if (process.env.AI_MOCK === 'true') return true;
  if (process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

const SYSTEM_PROMPT =
  'You are an AI that classifies recruitment outreach replies. Output STRICT JSON: ' +
  '{"category":"interested|not_now|not_interested|out_of_office|unsubscribe|spam|question|unknown",' +
  '"sentiment":"positive|neutral|negative|mixed",' +
  '"next_action":"schedule_call|send_followup|pause_sequence|remove_from_outreach|manual_review",' +
  '"confidence":0.00-1.00,' +
  '"reasoning":"short single sentence"} ' +
  'No other text, no fences.';

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1) {
    throw new Error('classifyReply: no JSON in response');
  }
  return JSON.parse(raw.slice(first, last + 1));
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

export async function classifyReply(
  tenantId: string,
  messageId: string
): Promise<ClassificationRow> {
  const startedAt = Date.now();

  return withTenant(tenantId, async (client) => {
    const { rows: [msg] } = await client.query<{
      id: string;
      body_text: string | null;
      direction: string;
    }>(
      `SELECT id, body_text, direction FROM outreach_messages
         WHERE id = $1 AND tenant_id = $2`,
      [messageId, tenantId]
    );
    if (!msg) {
      throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Reply niet gevonden');
    }
    if (msg.direction !== 'inbound') {
      throw new AppError(400, 'NOT_INBOUND', 'Alleen inbound berichten classificeren');
    }
    const text = msg.body_text ?? '';

    let result: HeuristicResult;
    let modelUsed: string;
    let mocked: boolean;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    if (shouldUseMock()) {
      result = classifyByHeuristic(text);
      modelUsed = `${CLASSIFIER_MODEL}-mock`;
      mocked = true;
    } else {
      try {
        const ai = await getClient();
        const response = await ai.messages.create({
          model: CLASSIFIER_MODEL,
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: text.slice(0, 4000) }],
        });
        const block = response.content.find((b) => b.type === 'text');
        const parsed = extractJson(block?.text ?? '') as Partial<HeuristicResult>;
        result = {
          category: (parsed.category ?? 'unknown') as ReplyCategory,
          sentiment: (parsed.sentiment ?? 'neutral') as ReplySentiment,
          next_action: (parsed.next_action ?? 'manual_review') as ReplyNextAction,
          confidence: clampConfidence(parsed.confidence),
          reasoning: parsed.reasoning ?? '',
        };
        modelUsed = CLASSIFIER_MODEL;
        mocked = false;
        promptTokens = response.usage?.input_tokens;
        completionTokens = response.usage?.output_tokens;
      } catch (err) {
        logger.warn('[replyClassifier] Claude call failed — falling back to heuristic', {
          messageId,
          error: (err as Error).message,
        });
        result = classifyByHeuristic(text);
        modelUsed = `${CLASSIFIER_MODEL}-fallback`;
        mocked = false;
      }
    }

    const { rows: [classification] } = await client.query<ClassificationRow>(
      `INSERT INTO reply_classifications
         (tenant_id, message_id, category, sentiment, next_action,
          reasoning, confidence, ai_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        messageId,
        result.category,
        result.sentiment,
        result.next_action,
        result.reasoning.slice(0, 1000),
        result.confidence,
        modelUsed,
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'outreach.reply.classified',
        entityType: 'outreach_message',
        entityId: messageId,
        after: {
          category: result.category,
          next_action: result.next_action,
          confidence: result.confidence,
        },
      },
      {}
    );

    void logAIEvent(tenantId, {
      feature: 'outreach_reply_classifier',
      model: modelUsed,
      provider: 'anthropic',
      input: text,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      outputSummary: `${result.category} (${result.confidence.toFixed(2)})`,
      latencyMs: Date.now() - startedAt,
      entityType: 'outreach_message',
      entityId: messageId,
      status: mocked ? 'mocked' : 'success',
    });

    return classification;
  });
}

function clampConfidence(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

// ───────────────────────────────────────────────────────────────────────────
// applyNextAction
// ───────────────────────────────────────────────────────────────────────────

export async function applyNextAction(
  tenantId: string,
  classificationId: string
): Promise<{ applied: ReplyNextAction; details?: Record<string, unknown> }> {
  const { row, candidateId, enrollmentId } = await withTenant(
    tenantId,
    async (client) => {
      const { rows: [r] } = await client.query<ClassificationRow>(
        `SELECT * FROM reply_classifications
           WHERE id = $1 AND tenant_id = $2`,
        [classificationId, tenantId]
      );
      if (!r) {
        throw new AppError(404, 'CLASSIFICATION_NOT_FOUND', 'Classificatie niet gevonden');
      }
      const { rows: [m] } = await client.query<{
        candidate_id: string;
        enrollment_id: string | null;
      }>(
        `SELECT candidate_id, enrollment_id FROM outreach_messages
           WHERE id = $1 AND tenant_id = $2`,
        [r.message_id, tenantId]
      );
      return { row: r, candidateId: m?.candidate_id ?? null, enrollmentId: m?.enrollment_id ?? null };
    }
  );

  switch (row.next_action) {
    case 'schedule_call': {
      if (!candidateId) break;
      await createTaskScheduleCall(tenantId, candidateId, classificationId);
      break;
    }
    case 'send_followup': {
      if (!candidateId) break;
      await enrollInDefaultFollowup(tenantId, candidateId);
      break;
    }
    case 'pause_sequence': {
      if (enrollmentId) {
        try {
          await nurturePause(tenantId, enrollmentId, { userId: null });
        } catch {
          /* already paused / stopped — ok */
        }
      }
      break;
    }
    case 'remove_from_outreach': {
      if (enrollmentId) {
        try {
          await nurtureStop(tenantId, enrollmentId, 'reply_classified_remove', {
            userId: null,
          });
        } catch {
          /* already stopped */
        }
      }
      if (candidateId) {
        await tagDoNotContact(tenantId, candidateId);
      }
      break;
    }
    case 'manual_review':
      // No-op — surfaces in /api/outreach/replies?unreviewed=true.
      break;
  }

  return { applied: row.next_action, details: { candidateId, enrollmentId } };
}

async function createTaskScheduleCall(
  tenantId: string,
  candidateId: string,
  classificationId: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    try {
      await client.query(
        `INSERT INTO tasks
           (tenant_id, entity_type, entity_id, title, description, status, due_at, metadata)
         VALUES ($1, 'candidate', $2, $3, $4, 'open', now() + interval '1 day', $5::jsonb)`,
        [
          tenantId,
          candidateId,
          'Plan kennismakingsgesprek',
          'AI heeft de reply geclassificeerd als "interested" — neem contact op om een gesprek te plannen.',
          JSON.stringify({ source: 'reply_classifier', classification_id: classificationId }),
        ]
      );
    } catch (err) {
      logger.warn('[replyClassifier] insert into tasks failed', {
        error: (err as Error).message,
      });
    }
  });
}

async function enrollInDefaultFollowup(
  tenantId: string,
  candidateId: string
): Promise<void> {
  const sequenceId = await loadDefaultFollowupSequenceId(tenantId);
  if (!sequenceId) return;
  try {
    await nurtureEnroll(tenantId, {
      candidateId,
      sequenceId,
      requireApproval: true,
      userId: null,
    });
  } catch (err) {
    logger.warn('[replyClassifier] follow-up enroll failed', {
      error: (err as Error).message,
    });
  }
}

async function loadDefaultFollowupSequenceId(tenantId: string): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    try {
      const { rows } = await client.query<{ value: string | null }>(
        `SELECT value FROM tenant_settings
           WHERE tenant_id = $1 AND key = 'default_followup_sequence_id'
           LIMIT 1`,
        [tenantId]
      );
      const v = rows[0]?.value;
      return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
      return null;
    }
  });
}

async function tagDoNotContact(tenantId: string, candidateId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    try {
      // Use candidates.metadata jsonb if a `do_not_contact` column doesn't exist.
      await client.query(
        `UPDATE candidates
            SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('do_not_contact', true, 'do_not_contact_set_at', to_jsonb(now()))
          WHERE id = $1 AND tenant_id = $2`,
        [candidateId, tenantId]
      );
    } catch (err) {
      logger.warn('[replyClassifier] tagDoNotContact failed', {
        error: (err as Error).message,
      });
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Listing
// ───────────────────────────────────────────────────────────────────────────

export interface ListReplyClassificationsFilters {
  category?: ReplyCategory;
  unreviewed?: boolean;
  cursor?: string;
  limit?: number;
}

export async function listReplyClassifications(
  tenantId: string,
  filters: ListReplyClassificationsFilters
): Promise<{ data: ClassificationRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.category) {
      values.push(filters.category);
      conds.push(`category = $${values.length}`);
    }
    if (filters.unreviewed) {
      // unreviewed = next_action === 'manual_review' (heuristic).
      conds.push(`next_action = 'manual_review'`);
    }
    if (filters.cursor) {
      values.push(filters.cursor);
      conds.push(`classified_at < $${values.length}`);
    }
    const { rows } = await client.query<ClassificationRow>(
      `SELECT * FROM reply_classifications
         WHERE ${conds.join(' AND ')}
         ORDER BY classified_at DESC, id DESC
         LIMIT ${limit + 1}`,
      values
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      next_cursor: hasMore ? data[data.length - 1].classified_at : null,
    };
  });
}
