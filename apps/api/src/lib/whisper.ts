/**
 * Whisper-client voor TalentFlow AI Interview Suite (Sprint Q3.4).
 *
 * Gebruikt OpenAI's `whisper-1` endpoint via de officiële `openai` SDK:
 * `client.audio.transcriptions.create({ file, model: 'whisper-1', language })`.
 *
 * In dev zonder OPENAI_API_KEY valt deze module terug op een hardcoded mock-
 * transcript van een plausibel NL-interviewfragment, zodat de hele pipeline
 * (upload → queue → worker → DB → AI-summary) end-to-end testbaar blijft
 * zonder API-kosten. In productie (NODE_ENV=production) gooien we keihard
 * een fout — we willen daar nooit fake transcripten wegschrijven.
 *
 * Whisper-1 limiet: 25 MB per request. Audio splitsing (chunk-merge) komt
 * in een volgende sprint; voor nu refusen we bestanden boven die grens met
 * een duidelijke foutmelding.
 */

import OpenAI, { toFile } from 'openai';
import { logger } from '../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Public types & constants
// ─────────────────────────────────────────────────────────────────────────────

export interface TranscribeResult {
  /** Volledige transcript-tekst (wat de spreker zei). */
  text: string;
  /** ISO-639-1 taalcode ('nl', 'en', ...). 'unknown' als niet detecteerbaar. */
  language: string;
  /** Geschatte audio-duur in seconden (Whisper rapporteert dit; mock = 60). */
  duration_seconds: number;
  /** True wanneer de mock-fallback is gebruikt (dev only). */
  mocked?: boolean;
  /** End-to-end latency in milliseconds. */
  latencyMs?: number;
}

export interface TranscribeOptions {
  /** ISO-639-1 hint, bv. 'nl'. Whisper kan auto-detecteren als leeggelaten. */
  language?: string;
  /**
   * Vrijetekst-prompt die Whisper helpt jargon, namen of context-specifieke
   * termen te herkennen — bv. de jobtitel + bedrijfsnaam + technologie-stack.
   * Max ~244 tokens (Whisper-limiet); we trimmen op 1000 chars.
   */
  prompt?: string;
  /**
   * Bestandsnaam (incl. extensie) die we aan de Whisper-API doorgeven. Whisper
   * leidt het audio-formaat af van de extensie (mp3, wav, m4a, webm, ...).
   * Default: 'audio.webm' — recorder-output van browser MediaRecorder.
   */
  filename?: string;
  /** Override de mime-type doorgegeven aan toFile. Default 'audio/webm'. */
  contentType?: string;
}

export const WHISPER_MODEL = 'whisper-1';

/** OpenAI-limiet voor whisper-1 (incl. response header overhead). */
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

const PROMPT_MAX_CHARS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Mock-fallback transcript (NL — plausibel interview-fragment van ~1 minuut)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hardcoded mock-transcript: ~60 seconden van een plausibel sollicitatie-
 * gesprek in het Nederlands. Bewust generiek (rol/seniority blijft open)
 * zodat de AI-summary worker er een realistische samenvatting + sterktes/
 * zorgen uit kan halen voor end-to-end tests.
 *
 * Deze mock-tekst is publiek leesbaar in de tests en in dev-logs — bevat
 * dus géén echte persoons- of bedrijfsnamen.
 */
export const MOCK_TRANSCRIPT_NL = [
  'Goedemorgen, fijn dat u tijd heeft kunnen vrijmaken. Mijn naam is de hiring manager voor deze positie.',
  'Vertelt u eerst eens iets over uzelf en wat u in deze rol aantrekt.',
  'Bedankt. Ik werk inmiddels ruim acht jaar als software engineer, voornamelijk in backend-systemen.',
  'De afgelopen drie jaar heb ik een team van vier developers geleid bij een mid-market SaaS-bedrijf.',
  'We hebben de migratie van een monolithische architectuur naar een micro-services platform succesvol afgerond.',
  'Wat me in deze rol aanspreekt is de combinatie van technisch leiderschap en het werken aan een product met directe impact op recruiters.',
  'Begrijpelijk. Kunt u een concreet voorbeeld geven van een lastige technische beslissing waar u recent voor stond?',
  'Zeker. We moesten kiezen tussen een full rewrite van onze authenticatie-laag of een geleidelijke migratie via een proxy-laag.',
  'Ik heb gekozen voor de proxy-aanpak omdat dat ons in staat stelde om week-na-week features te leveren zonder big-bang risico.',
  'Het kostte uiteindelijk drie maanden langer maar de uptime is gedurende de hele migratie 99,95% gebleven.',
  'Mooi voorbeeld. En hoe gaat u om met conflicten binnen het team?',
  'Ik probeer eerst te begrijpen waar het conflict echt over gaat — vaak is het niet de technische keuze maar onderliggende communicatie.',
  'Recent hadden we discussie tussen twee senior developers over code-style. Bleek vooral een gevoel van niet-gehoord-worden.',
  'Na een een-op-een gesprek met beiden hebben we samen onze styleguide gereviseerd. Dat heeft de spanning weggenomen.',
  'Dank u. Heeft u zelf nog vragen voor mij over de positie of het team?',
  'Ja, ik ben benieuwd hoe het team momenteel is samengesteld qua seniority en welke roadmap-prioriteiten het komende kwartaal voorop staan.',
].join(' ');

// ─────────────────────────────────────────────────────────────────────────────
// Singleton client
// ─────────────────────────────────────────────────────────────────────────────

let cachedClient: OpenAI | null = null;
let warnedAboutMissingKey = false;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[whisper] OPENAI_API_KEY ontbreekt in productie — refusing to mock.'
      );
    }
    if (!warnedAboutMissingKey) {
      logger.warn(
        '[whisper] OPENAI_API_KEY ontbreekt — gebruik hardcoded mock-transcript. ' +
          'Dit is alleen geldig in dev/test.'
      );
      warnedAboutMissingKey = true;
    }
    return null;
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transcribeer een audio-buffer met Whisper-1.
 *
 * @param audioBuffer  Ruwe audio-bytes (mp3/wav/m4a/webm/etc.).
 * @param options      Taalcode-hint, prompt-context, filename-hint.
 *
 * @throws Error als buffer leeg is OF > 25 MB OF in productie zonder key.
 * @throws OpenAI-API errors gewoon door — caller (worker) handelt retry.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  options: TranscribeOptions = {}
): Promise<TranscribeResult> {
  const startedAt = Date.now();

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('[whisper] Lege audio-buffer — kan niet transcriberen');
  }
  if (audioBuffer.length > WHISPER_MAX_BYTES) {
    throw new Error(
      `[whisper] Audio te groot (${audioBuffer.length} bytes > ${WHISPER_MAX_BYTES} bytes Whisper-limiet). ` +
        'Splits in chunks of vraag een upgrade aan.'
    );
  }

  const client = getOpenAIClient();
  if (!client) {
    // Mock-fallback voor dev/test.
    const latencyMs = Date.now() - startedAt;
    return {
      text: MOCK_TRANSCRIPT_NL,
      language: options.language ?? 'nl',
      duration_seconds: 60,
      mocked: true,
      latencyMs,
    };
  }

  // Trim prompt zodat we Whisper's interne 244-token context-window niet overrunnen.
  const trimmedPrompt = options.prompt
    ? options.prompt.slice(0, PROMPT_MAX_CHARS)
    : undefined;

  const filename = options.filename ?? 'audio.webm';
  const contentType = options.contentType ?? 'audio/webm';

  // De openai SDK accepteert een `Uploadable`. `toFile` wikkelt onze Node-Buffer
  // tot een entry die de SDK kan multipart-uploaden.
  const file = await toFile(audioBuffer, filename, { type: contentType });

  // We vragen om verbose_json om aan duration_seconds + language te komen.
  const response = await client.audio.transcriptions.create({
    file,
    model: WHISPER_MODEL,
    language: options.language,
    prompt: trimmedPrompt,
    response_format: 'verbose_json',
  });

  // De SDK-types onderscheiden niet altijd tussen response_format='json' (alleen `text`)
  // en 'verbose_json' (met `language` + `duration`). Defensief casten + fallback.
  const verbose = response as unknown as {
    text?: string;
    language?: string;
    duration?: number;
  };

  const latencyMs = Date.now() - startedAt;
  return {
    text: verbose.text ?? '',
    language: verbose.language ?? options.language ?? 'unknown',
    duration_seconds:
      typeof verbose.duration === 'number' && Number.isFinite(verbose.duration)
        ? Math.round(verbose.duration)
        : 0,
    latencyMs,
  };
}

/**
 * Test-helper — reset de gecachte OpenAI-client. Alleen door unit-tests
 * gebruikt om mock-mode tussen tests te wisselen zonder module-reload.
 */
export function _resetWhisperClientForTests(): void {
  cachedClient = null;
  warnedAboutMissingKey = false;
}
