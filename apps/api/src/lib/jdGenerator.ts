/**
 * AI vacaturetekst (JD) generator — Sprint Q3.2.
 *
 * Genereert N varianten van een vacaturetekst in één Claude-call. Eén call
 * (ipv N parallelle calls) is bewust:
 *   • bespaart tokens — system-prompt wordt 1x verstuurd ipv N keer
 *   • produceert betere variatie — het model ziet de andere varianten en
 *     houdt onderscheid tussen tone/stijl
 *   • atomair voor rate-limiting en latency
 *
 * Per variant runnen we vervolgens een lichtgewicht clarity- en bias-pass:
 *   • clarity_score: gewogen heuristic (avg sentence length + passive voice).
 *   • inclusivity_score + bias_flags: regel-gebaseerde NL-Engelse phrase
 *     check (zelfde categorieën als jobBiasCheck.service.ts).
 *
 * Mock-fallback (NODE_ENV !== production && geen ANTHROPIC_API_KEY): vaste
 * NL-talige template gebaseerd op role + level zodat frontend/worker-flows
 * lokaal getest kunnen worden zonder API-kosten. In productie throwt de
 * lib zonder key — net als aiParser.ts en jobBiasCheck.service.ts.
 *
 * Logging: caller (jdGenerator.service) schrijft een ai_events-rij met
 * `feature='jd_generator'` op basis van het _meta-veld in de respons.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from '../middleware/errorHandler';
import type { BiasFlag, BiasFlagType } from '../modules/jobs/jobBiasCheck.service';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type JdLevel = 'junior' | 'medior' | 'senior' | 'lead' | 'director';
export type JdTone = 'formal' | 'casual' | 'direct' | 'enthusiastic';
export type JdLength = 'short' | 'medium' | 'long';
export type JdLanguage = 'nl' | 'en' | 'de' | 'fr';

export interface JdGeneratorInput {
  role: string;
  level?: JdLevel;
  key_skills?: string[];
  must_haves?: string[];
  nice_to_haves?: string[];
  tone?: JdTone;
  length?: JdLength;
  language?: JdLanguage;
  company_context?: string;
  /** Aantal te genereren varianten. Default 3 voor A/B testen, max 5. */
  generate_variants?: number;
}

export interface JdVariant {
  id: string;
  title: string;
  /** Markdown-formatted body. */
  description: string;
  bias_flags: BiasFlag[];
  /** 0-100. Hogere score = helderder. */
  clarity_score: number;
  /** 0-100. Hogere score = inclusiever. */
  inclusivity_score: number;
  word_count: number;
}

export interface GenerateJdMeta {
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  mocked: boolean;
  model: string;
}

export interface GenerateJdResult {
  variants: JdVariant[];
  mocked: boolean;
  _meta: GenerateJdMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL = process.env.JD_GENERATOR_MODEL ?? 'claude-opus-4-7';
const FALLBACK_MODEL = process.env.JD_GENERATOR_FALLBACK_MODEL ?? 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4000;
const DEFAULT_VARIANTS = 3;
const MAX_VARIANTS = 5;

const LENGTH_WORD_TARGETS: Record<JdLength, [number, number]> = {
  short: [150, 250],
  medium: [300, 500],
  long: [600, 900],
};

const LANGUAGE_LABELS: Record<JdLanguage, string> = {
  nl: 'Nederlands',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
};

const TONE_INSTRUCTIONS: Record<JdTone, string> = {
  formal: 'formeel, zakelijk, en respectvol — vermijd contracties',
  casual: 'luchtig en uitnodigend — duzen waar passend, korte zinnen',
  direct: 'kort en bondig — actieve werkwoorden, geen omhaal',
  enthusiastic: 'energiek en wervend — concrete voorbeelden van impact',
};

// ─────────────────────────────────────────────────────────────────────────────
// zod schema voor de Claude-respons
// ─────────────────────────────────────────────────────────────────────────────

const aiVariantSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(40).max(10_000),
});

const aiResponseSchema = z.object({
  variants: z.array(aiVariantSchema).min(1).max(MAX_VARIANTS),
});

// ─────────────────────────────────────────────────────────────────────────────
// Heuristics — clarity, inclusivity, bias-flags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits text into sentence-like fragments for clarity-scoring.
 * Markdown-headers en lijsten tellen niet als zin.
 */
function splitSentences(text: string): string[] {
  const stripped = text
    .replace(/^#{1,6}\s+.*$/gm, '') // strip markdown headers
    .replace(/^[*\-+]\s+/gm, '')    // strip bullet markers
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return [];
  return stripped
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÿ])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countWords(text: string): number {
  if (!text) return 0;
  return text
    .replace(/[#*_`>\-]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[A-Za-zÀ-ÿ0-9]/.test(w)).length;
}

/**
 * Clarity score — combineert (a) gemiddelde zinslengte (kortere zinnen ⇒
 * helderder, gepenalized boven 25 woorden) en (b) percentage passieve zinnen
 * (NL "wordt/worden" of EN "is/are <verb>ed" met simpele heuristic).
 */
export function computeClarityScore(description: string): number {
  const sentences = splitSentences(description);
  if (sentences.length === 0) return 50;

  const totalWords = sentences.reduce((sum, s) => sum + countWords(s), 0);
  const avgLen = totalWords / sentences.length;

  // Score (a): 100 punten voor avg ≤ 14, lineair afgebouwd tot 0 bij avg ≥ 30.
  const lengthScore = Math.max(0, Math.min(100, 100 - (avgLen - 14) * 6.25));

  // Score (b): % zinnen met NL-passive markers ('wordt','worden') of EN ('is/are <past-participle>').
  const passiveMatchers: RegExp[] = [
    /\b(wordt|worden|werd|werden)\s+\w+/i,
    /\b(is|are|was|were)\s+\w+(ed|en)\b/i,
  ];
  const passiveCount = sentences.filter((s) =>
    passiveMatchers.some((re) => re.test(s))
  ).length;
  const passiveRatio = passiveCount / sentences.length;
  const passiveScore = Math.max(0, 100 - passiveRatio * 200); // 50% passive ⇒ 0

  // Weighted average: 65% length, 35% passive.
  const score = lengthScore * 0.65 + passiveScore * 0.35;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Lichtgewicht bias-detector — regel-gebaseerd, geen extra Claude-call. Dekt
 * dezelfde BiasFlagType-set als jobBiasCheck.service.ts. Recruiter kan
 * achteraf een dieper bias-check op de gepubliceerde job draaien.
 */
const BIAS_PATTERNS: Array<{
  type: BiasFlagType;
  regex: RegExp;
  textTemplate: (match: string) => string;
  suggestion: string;
}> = [
  // Gendered language (NL + EN)
  {
    type: 'gendered_language',
    regex: /\b(rockstar|ninja|guru|salesman|salesmen|chairman|cameraman)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Vervang door een neutrale term (bijv. "ervaren professional", "verkoopmedewerker", "voorzitter").',
  },
  {
    type: 'gendered_language',
    regex: /\b(young|youthful|jong\s+team|jonge\s+collega'?s)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Vermijd verwijzingen naar leeftijd. Beschrijf het team op basis van werkstijl ("informeel team").',
  },
  // Age indicators
  {
    type: 'age_indicator',
    regex: /\b(\d{1,2}\+?)\s*(jaar|years?)\s+(ervaring|experience)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Beschrijf gewenste ervaring in termen van vaardigheden en projecten in plaats van jaren.',
  },
  {
    type: 'age_indicator',
    regex: /\b(digital\s+native|recently\s+graduated|net\s+afgestudeerd)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Vermijd termen die naar leeftijd of generatie verwijzen.',
  },
  // Unrealistic requirements
  {
    type: 'unrealistic_requirement',
    regex: /\b(10\+?|15\+?|20\+?)\s*(jaar|years?)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Heel hoge eisen aan jaren ervaring schrikken kandidaten af. Heroverweeg richting 3-5 jaar als de skills aanwezig zijn.',
  },
  // Exclusionary
  {
    type: 'exclusionary',
    regex: /\b(native\s+speaker|moedertaal|moedertalig)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Vervang door een concreet taalniveau (bijv. C1/C2) — meer inclusief en juridisch veiliger.',
  },
  {
    type: 'exclusionary',
    regex: /\b(fulltime\s+inzetbaar|geen\s+parttime|alleen\s+fulltime)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Tenzij echt vereist, sluit parttime niet expliciet uit — dat reduceert je talentpool.',
  },
  // Jargon
  {
    type: 'jargon',
    regex: /\b(synerg(?:y|ie)|low-?hanging\s+fruit|move\s+the\s+needle|out\s+of\s+the\s+box)\b/i,
    textTemplate: (m) => m,
    suggestion: 'Vervang door concreet werkwoord; deze frase is leeg jargon.',
  },
];

export function detectBiasFlags(description: string): BiasFlag[] {
  const flags: BiasFlag[] = [];
  const seen = new Set<string>();
  for (const pattern of BIAS_PATTERNS) {
    const match = pattern.regex.exec(description);
    if (!match) continue;
    const key = `${pattern.type}:${match[0].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({
      type: pattern.type,
      text: pattern.textTemplate(match[0]).slice(0, 200),
      suggestion: pattern.suggestion.slice(0, 200),
    });
    if (flags.length >= 10) break;
  }
  return flags;
}

/**
 * Inclusivity score — 100 minus 10 punten per detected bias-flag, met een
 * floor van 30 zodat een tekst met heel veel issues nog steeds een actief
 * signaal geeft (en niet 0 wordt — dat lijkt een fout).
 */
export function computeInclusivityScore(flags: BiasFlag[]): number {
  const penalty = Math.min(70, flags.length * 10);
  return Math.max(30, 100 - penalty);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(input: JdGeneratorInput, variantCount: number): string {
  const language = input.language ?? 'nl';
  const tone = input.tone ?? 'casual';
  const length = input.length ?? 'medium';
  const [minWords, maxWords] = LENGTH_WORD_TARGETS[length];
  const langLabel = LANGUAGE_LABELS[language];

  return [
    `Je bent een Nederlandstalige recruitment-AI die professionele vacatureteksten schrijft in ${langLabel}.`,
    `Genereer EXACT ${variantCount} verschillende varianten van dezelfde vacature, elk met een eigen titel en beschrijving.`,
    '',
    'STIJL-INSTRUCTIES:',
    `- Toon: ${TONE_INSTRUCTIONS[tone]}.`,
    `- Lengte per variant: ${minWords}-${maxWords} woorden.`,
    `- Schrijf in ${langLabel}.`,
    '- Markdown toegestaan voor structuur (## Wat ga je doen, **Wat we zoeken**, lijsten).',
    '- Vermijd gendered language, leeftijdsverwijzingen, jargon en onrealistische eisen ("10+ jaar ervaring").',
    '- Schrijf inclusief: "C1-niveau Nederlands" ipv "native speaker".',
    '',
    'VARIATIE TUSSEN DE VARIANTEN:',
    '- Variant 1: focus op impact en groei (wat ga je bouwen, hoe maak je verschil).',
    '- Variant 2: focus op team en cultuur (hoe is het werken hier, met wie).',
    '- Variant 3: focus op concrete dagelijkse taken en deliverables.',
    '- Bij meer dan 3 varianten: combineer elementen, maar houd ze duidelijk verschillend.',
    '',
    'STRIKT OUTPUT-FORMAAT:',
    '- Antwoord UITSLUITEND met een geldig JSON-object — geen begeleidende tekst, geen markdown-fences (```).',
    '- Schema: { "variants": [{ "title": "...", "description": "..." }, ...] }',
    `- Het variants-array moet exact ${variantCount} items hebben.`,
    '- description gebruikt \\n voor regelovergangen (geen letterlijke newlines die de JSON breken).',
  ].join('\n');
}

function buildUserPrompt(input: JdGeneratorInput): string {
  const lines: string[] = [
    `Vacature voor: ${input.role}`,
  ];
  if (input.level) lines.push(`Niveau: ${input.level}`);
  if (input.key_skills && input.key_skills.length > 0) {
    lines.push(`Belangrijkste skills: ${input.key_skills.join(', ')}`);
  }
  if (input.must_haves && input.must_haves.length > 0) {
    lines.push(`Must-haves: ${input.must_haves.join(', ')}`);
  }
  if (input.nice_to_haves && input.nice_to_haves.length > 0) {
    lines.push(`Nice-to-haves: ${input.nice_to_haves.join(', ')}`);
  }
  if (input.company_context) {
    lines.push('', 'Bedrijfscontext:', input.company_context);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(
      `jdGenerator: geen JSON-object gevonden in respons (preview: ${raw.slice(0, 500)})`
    );
  }
  const slice = raw.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    throw new Error(
      `jdGenerator: JSON.parse faalde (${(err as Error).message}); preview: ${raw.slice(0, 500)}`
    );
  }
}

function getResponseText(message: Anthropic.Messages.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

function isTransientApiError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number };
  const status = e?.status ?? e?.statusCode;
  return status === 429 || status === 500 || status === 502 || status === 503;
}

function clampVariantCount(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return DEFAULT_VARIANTS;
  return Math.max(1, Math.min(MAX_VARIANTS, Math.floor(n)));
}

// ─── Anthropic-client (lazy singleton) ──────────────────────────────────────

let cachedClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY ontbreekt: vereist voor JD-generator in productie.'
      );
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

let warnedAboutMissingKey = false;
function shouldUseMockFallback(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (!warnedAboutMissingKey) {
    logger.warn(
      '[jdGenerator] ANTHROPIC_API_KEY ontbreekt — dev-fallback met mock-varianten actief'
    );
    warnedAboutMissingKey = true;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock varianten — deterministisch genoeg voor tests
// ─────────────────────────────────────────────────────────────────────────────

function buildMockVariants(input: JdGeneratorInput, count: number): Array<{
  title: string;
  description: string;
}> {
  const role = input.role.trim();
  const level = input.level ?? 'medior';
  const skillsLine =
    input.key_skills && input.key_skills.length > 0
      ? input.key_skills.join(', ')
      : 'relevante technische vaardigheden';

  const angles = [
    {
      title: `${role} (${level}) — bouw mee aan onze impact`,
      description: [
        `## Over de rol`,
        `Als ${role} bij ons team werk je aan oplossingen die direct verschil maken voor onze klanten.`,
        '',
        `## Wat ga je doen`,
        `- Ontwerpen en bouwen van features in samenwerking met product en design`,
        `- Code reviews en mentoring van collega's`,
        `- Bijdragen aan onze technische roadmap`,
        '',
        `## Wat we zoeken`,
        `- Ervaring met ${skillsLine}`,
        `- Eigenaarschap en pragmatische instelling`,
        `- C1-niveau Nederlands of Engels`,
      ].join('\n'),
    },
    {
      title: `${role} bij een team dat samenwerkt`,
      description: [
        `## Het team`,
        `Je komt in een informeel team met korte lijnen, waar we elkaar uitdagen en helpen groeien.`,
        '',
        `## Jouw bijdrage`,
        `- Samenwerken met product, design en engineering`,
        `- Kennis delen via tech talks en pairing`,
        `- Bijdragen aan een cultuur van blijven leren`,
        '',
        `## Wat we vragen`,
        `- Vaardigheid in ${skillsLine}`,
        `- Open communicatie en feedback geven/ontvangen`,
        `- Werkbeheersing van het Nederlands op C1-niveau`,
      ].join('\n'),
    },
    {
      title: `${role} — concreet werk, concrete resultaten`,
      description: [
        `## Wat je deze week zou doen`,
        `Maandag: refinement van een nieuwe feature met de PO. Woensdag: pull requests reviewen en je eigen werk uitleveren. Vrijdag: incident-postmortem met het team.`,
        '',
        `## Eisen`,
        `- Werkervaring met ${skillsLine}`,
        `- Aantoonbare projecten of repo's te delen`,
        `- Voldoende beheersing van het Nederlands op werkniveau`,
        '',
        `## Aanbod`,
        `- Marktconform salaris`,
        `- Hybride werken`,
        `- Persoonlijk ontwikkelbudget`,
      ].join('\n'),
    },
    {
      title: `${role} (${level}) — neem het voortouw`,
      description: [
        `## Over de positie`,
        `In deze rol pak je vraagstukken op vanaf het allereerste idee tot in productie.`,
        '',
        `## Verantwoordelijkheden`,
        `- Architectuurkeuzes voor jouw domein`,
        `- Junior collega's begeleiden in hun groei`,
        `- Stakeholders informeren over voortgang en risico's`,
        '',
        `## Profiel`,
        `- Diepgaande kennis van ${skillsLine}`,
        `- Communicatieve vaardigheden`,
        `- Werkbeheersing Nederlands C1`,
      ].join('\n'),
    },
    {
      title: `${role} — flexibel, betrokken en leergierig`,
      description: [
        `## Wie zoeken we`,
        `Iemand die ${skillsLine} beheerst en het leuk vindt om met collega's nieuwe dingen uit te proberen.`,
        '',
        `## Wat je gaat doen`,
        `- Werken aan zowel nieuwe features als technische verbeteringen`,
        `- Onderdeel zijn van on-call rotaties (eerlijk verdeeld)`,
        `- Helpen onze test- en deploy-pipeline scherp houden`,
        '',
        `## Wat wij bieden`,
        `- Ruimte voor eigen ideeën`,
        `- Een leergierig en respectvol team`,
        `- Marktconform salaris`,
      ].join('\n'),
    },
  ];

  return angles.slice(0, count);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function generateJd(
  input: JdGeneratorInput
): Promise<GenerateJdResult> {
  const startedAt = Date.now();
  const variantCount = clampVariantCount(input.generate_variants);

  // ── 1) Genereer raw varianten — Claude of mock ─────────────────────────
  let rawVariants: Array<{ title: string; description: string }>;
  let mocked: boolean;
  let modelUsed: string;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  if (shouldUseMockFallback()) {
    rawVariants = buildMockVariants(input, variantCount);
    mocked = true;
    modelUsed = `${PRIMARY_MODEL}-mock`;
  } else {
    const client = getAnthropicClient();
    const systemPrompt = buildSystemPrompt(input, variantCount);
    const userPrompt = buildUserPrompt(input);

    const callModel = async (
      model: string
    ): Promise<Anthropic.Messages.Message> => {
      return client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
    };

    let response: Anthropic.Messages.Message;
    modelUsed = PRIMARY_MODEL;
    try {
      response = await callModel(PRIMARY_MODEL);
    } catch (err) {
      if (!isTransientApiError(err)) throw err;
      logger.warn('[jdGenerator] primary model faalde — retry op fallback', {
        model: PRIMARY_MODEL,
        fallback: FALLBACK_MODEL,
        error: (err as Error).message,
      });
      response = await callModel(FALLBACK_MODEL);
      modelUsed = FALLBACK_MODEL;
    }

    const rawText = getResponseText(response);
    if (!rawText) {
      throw new Error('jdGenerator: lege respons van Claude (geen text-block).');
    }
    const candidate = extractJson(rawText);
    const validated = aiResponseSchema.safeParse(candidate);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(
        `jdGenerator: schema-validatie faalde (${issues}); preview: ${rawText.slice(0, 500)}`
      );
    }
    rawVariants = validated.data.variants.slice(0, variantCount);
    mocked = false;
    inputTokens = response.usage?.input_tokens ?? undefined;
    outputTokens = response.usage?.output_tokens ?? undefined;
  }

  // ── 2) Score elke variant + bouw final shape ────────────────────────────
  const variants: JdVariant[] = rawVariants.map((rv) => {
    const flags = detectBiasFlags(`${rv.title}\n${rv.description}`);
    const clarity = computeClarityScore(rv.description);
    const inclusivity = computeInclusivityScore(flags);
    return {
      id: randomUUID(),
      title: rv.title.trim().slice(0, 200),
      description: rv.description.trim(),
      bias_flags: flags,
      clarity_score: clarity,
      inclusivity_score: inclusivity,
      word_count: countWords(rv.description),
    };
  });

  return {
    variants,
    mocked,
    _meta: {
      latencyMs: Date.now() - startedAt,
      inputTokens,
      outputTokens,
      mocked,
      model: modelUsed,
    },
  };
}

/**
 * Genereer 1 nieuwe variant — gebruikt door regenerateVariant in de service
 * laag. We hergebruiken generateJd met generate_variants=1 zodat alle scoring
 * en bias-detectie consistent is.
 */
export async function generateSingleJdVariant(
  input: JdGeneratorInput
): Promise<{ variant: JdVariant; mocked: boolean; _meta: GenerateJdMeta }> {
  const result = await generateJd({ ...input, generate_variants: 1 });
  return {
    variant: result.variants[0],
    mocked: result.mocked,
    _meta: result._meta,
  };
}
