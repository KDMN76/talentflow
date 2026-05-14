/**
 * AI-resume-parser voor TalentFlow.
 *
 * Gebruikt Anthropic Claude (model `claude-opus-4-7`) met fallback op
 * `claude-haiku-4-5-20251001`. Vraagt strikt JSON output volgens een vast
 * schema en valideert de respons met zod.
 *
 * In dev zonder ANTHROPIC_API_KEY valt de parser terug op een mock-implementatie
 * met plausibele dummy-data — bedoeld om frontend/worker-flows lokaal te kunnen
 * testen zonder API-kosten. In productie (NODE_ENV=production) gooien we keihard
 * een fout zodra de key ontbreekt; we willen daar nooit dummy data wegschrijven.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedResume {
  summary: string;
  skills: Array<{ skill: string; score: number }>;
  years_of_experience: number | null;
  languages: string[];
  current_position: string | null;
  current_company: string | null;
  /**
   * Diagnostic info — niet gepersisteerd op `candidates`, maar door de
   * caller (resume parser worker) gebruikt om `ai_events` te schrijven.
   * Optioneel zodat oudere call-sites die deze velden negeren niet breken.
   */
  _meta?: {
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    mocked: boolean;
    model: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL = 'claude-opus-4-7';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2000;
const MAX_RESUME_CHARS = 12_000;
const MAX_SKILLS = 25;

const SYSTEM_PROMPT = [
  'Je bent een Nederlandstalige recruitment-AI die CV\'s analyseert voor een ATS.',
  'Je krijgt een ruwe CV-tekst en moet hier gestructureerde data uit halen.',
  '',
  'STRIKT OUTPUT-FORMAAT:',
  '- Antwoord UITSLUITEND met een geldig JSON-object — geen begeleidende tekst.',
  '- GEEN markdown-fences (```), GEEN uitleg, GEEN voor- of nawoord.',
  '- Het JSON-object moet exact deze keys hebben: summary, skills, years_of_experience, languages, current_position, current_company.',
  '',
  'VELD-INSTRUCTIES:',
  '- summary: exact 3 Nederlandstalige zinnen (profiel + sterkte + ervaring-jaren). Beknopt en feitelijk.',
  '- skills: array van {skill, score}. Maximaal 25 items, geen duplicaten (case-insensitive). Skills in originele schrijfwijze ("React", "TypeScript", niet "react").',
  '- years_of_experience: integer (afgerond), of null als niet af te leiden.',
  '- languages: array van ISO-Nederlandstalige namen ("Nederlands","Engels","Duits","Frans",...). Lege array als onbekend.',
  '- current_position: huidige functietitel, of null. NIET de meest recente afgesloten functie.',
  '- current_company: huidige werkgever, of null.',
  '',
  'SKILL-SCORE RUBRIEK (1-10):',
  '- 1-3: skill is alleen vermeld, zonder context.',
  '- 4-6: kandidaat heeft de skill enkele jaren actief gebruikt.',
  '- 7-9: significante projecten of duidelijke expertise (lead engineer, architect rol).',
  '- 10: lead/expert-niveau, mentorrol, gepubliceerde content of conferentie-sprekers.',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// zod schema voor de AI-respons
// ─────────────────────────────────────────────────────────────────────────────

const skillItemSchema = z.object({
  skill: z.string().trim().min(1).max(80),
  score: z.number().int().min(1).max(10),
});

const parsedResumeSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  skills: z.array(skillItemSchema).max(MAX_SKILLS).default([]),
  years_of_experience: z.number().int().min(0).max(70).nullable(),
  languages: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  current_position: z.string().trim().min(1).max(200).nullable(),
  current_company: z.string().trim().min(1).max(200).nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pak het eerste { en laatste } uit een respons en parse als JSON.
 * Models vergissen zich soms en zetten markdown-fences of een leading-zin
 * vóór de JSON. Door op braces te trimmen vangen we dat netjes af.
 */
function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(
      `AI parser: geen JSON-object gevonden in respons (preview: ${raw.slice(0, 500)})`
    );
  }
  const slice = raw.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    throw new Error(
      `AI parser: JSON.parse faalde (${(err as Error).message}); preview: ${raw.slice(0, 500)}`
    );
  }
}

/**
 * Maak skills uniek op (case-insensitive) skill-naam, behoudt hoogste score
 * bij dubbeling, en kapt af op MAX_SKILLS.
 */
function dedupeSkills(
  input: Array<{ skill: string; score: number }>
): Array<{ skill: string; score: number }> {
  const map = new Map<string, { skill: string; score: number }>();
  for (const item of input) {
    const key = item.skill.toLowerCase().trim();
    const existing = map.get(key);
    if (!existing || item.score > existing.score) {
      map.set(key, { skill: item.skill.trim(), score: item.score });
    }
  }
  return Array.from(map.values()).slice(0, MAX_SKILLS);
}

/**
 * Pakt de eerste text-block uit een Anthropic-message-respons.
 */
function getResponseText(message: Anthropic.Messages.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }
  return '';
}

/**
 * Bepaal of een Anthropic-fout transient is (429/500/503) en dus retry-waardig
 * via een fallback-model.
 */
function isTransientApiError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number };
  const status = e?.status ?? e?.statusCode;
  return status === 429 || status === 500 || status === 502 || status === 503;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock implementatie (alleen dev-zonder-API-key)
// ─────────────────────────────────────────────────────────────────────────────

function buildMockParse(resumeText: string, latencyMs: number): ParsedResume {
  // Heuristisch: knip iets van de tekst om een plausibele samenvatting te krijgen.
  const trimmed = resumeText.replace(/\s+/g, ' ').trim().slice(0, 240);
  return {
    summary: [
      'Mock-samenvatting: deze parse is gegenereerd zonder AI omdat ANTHROPIC_API_KEY ontbreekt.',
      `CV-fragment: ${trimmed || '(leeg)'}.`,
      'Plausibele dummy-data; configureer een API key voor echte parsing.',
    ].join(' '),
    skills: [
      { skill: 'JavaScript', score: 5 },
      { skill: 'TypeScript', score: 6 },
      { skill: 'Node.js', score: 7 },
    ],
    years_of_experience: 3,
    languages: ['Nederlands', 'Engels'],
    current_position: null,
    current_company: null,
    _meta: {
      latencyMs,
      mocked: true,
      model: `${PRIMARY_MODEL}-mock`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic-client (lazy singleton)
// ─────────────────────────────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY ontbreekt: vereist voor AI-parsing in productie.'
      );
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

/**
 * Geeft true als we een live AI-client hebben, false als we moeten terugvallen
 * op de mock. Logt een waarschuwing bij eerste aanroep zonder key.
 */
let warnedAboutMissingKey = false;
function shouldUseMockFallback(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return false;

  // Productie mag NOOIT stilzwijgend mock-data wegschrijven.
  if (process.env.NODE_ENV === 'production') return false;

  if (!warnedAboutMissingKey) {
    logger.warn(
      '[aiParser] ANTHROPIC_API_KEY ontbreekt — dev-fallback met mock-parser actief'
    );
    warnedAboutMissingKey = true;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse een CV met Claude. Returnt gestructureerde data inclusief skills met
 * scores 1-10. Gooit een Error met preview-context als de respons niet als
 * JSON valideert.
 *
 * @param resumeText      Ruwe tekst uit pdf-parse / mammoth.
 * @param languageHint    Optioneel: ISO-naam ("Nederlands","Engels") om de
 *                        AI te biasen voor de juiste samenvattingstaal.
 *                        De systeem-prompt vraagt sowieso om Nederlandse
 *                        samenvatting; dit is een hint voor skill-vertalingen.
 */
export async function parseResumeWithAI(
  resumeText: string,
  languageHint?: string
): Promise<ParsedResume> {
  const startedAt = Date.now();
  if (shouldUseMockFallback()) {
    return buildMockParse(resumeText, Date.now() - startedAt);
  }

  const client = getAnthropicClient();

  // Knip CV-tekst af op model hard-limit safety
  const safeText = resumeText.slice(0, MAX_RESUME_CHARS);

  const userPrompt = [
    languageHint
      ? `De kandidaat is vermoedelijk ${languageHint}-talig. Houd hier rekening mee bij skill-namen.`
      : null,
    'Hieronder volgt de ruwe CV-tekst. Analyseer deze en retourneer JSON volgens het afgesproken schema.',
    '',
    '--- BEGIN CV ---',
    safeText,
    '--- EINDE CV ---',
  ]
    .filter(Boolean)
    .join('\n');

  const callModel = async (model: string): Promise<Anthropic.Messages.Message> => {
    return client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
  };

  let response: Anthropic.Messages.Message;
  let modelUsed = PRIMARY_MODEL;
  try {
    response = await callModel(PRIMARY_MODEL);
  } catch (err) {
    if (!isTransientApiError(err)) throw err;
    logger.warn('[aiParser] primary model faalde — retry op fallback', {
      model: PRIMARY_MODEL,
      fallback: FALLBACK_MODEL,
      error: (err as Error).message,
    });
    response = await callModel(FALLBACK_MODEL);
    modelUsed = FALLBACK_MODEL;
  }

  const rawText = getResponseText(response);
  if (!rawText) {
    throw new Error('AI parser: lege respons van Claude (geen text-block).');
  }

  const candidate = extractJson(rawText);
  const validated = parsedResumeSchema.safeParse(candidate);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `AI parser: schema-validatie faalde (${issues}); preview: ${rawText.slice(0, 500)}`
    );
  }

  // Post-process: dedupe skills (AI kan dubbelingen produceren ondanks instructie)
  const data = validated.data;
  return {
    summary: data.summary,
    skills: dedupeSkills(data.skills),
    years_of_experience: data.years_of_experience,
    languages: data.languages,
    current_position: data.current_position,
    current_company: data.current_company,
    _meta: {
      latencyMs: Date.now() - startedAt,
      // Anthropic SDK exposes usage on the message — beide tokens zijn
      // optioneel zodat we niet crashen als het ontbreekt.
      inputTokens: response.usage?.input_tokens ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
      mocked: false,
      model: modelUsed,
    },
  };
}
