/**
 * Whisper-client tests — Sprint Q3.4 (Agent CCC).
 *
 * In dit testbestand draaien we ALTIJD in mock-mode: setup.ts deletet
 * OPENAI_API_KEY uit het environment, dus `transcribeAudio` valt automatisch
 * terug op de hardcoded NL-mock-transcript.
 *
 * Coverage:
 *   - mock-fallback: lege key → fixture-text.
 *   - lege buffer → throw.
 *   - oversize buffer (>25MB) → throw.
 *   - taal-hint wordt gerespecteerd in mock-output.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  transcribeAudio,
  MOCK_TRANSCRIPT_NL,
  WHISPER_MAX_BYTES,
  _resetWhisperClientForTests,
} from '../../src/lib/whisper';

describe('whisper.transcribeAudio (mock-mode)', () => {
  beforeEach(() => {
    _resetWhisperClientForTests();
    delete process.env.OPENAI_API_KEY;
  });

  it('returnt de hardcoded NL-mock-transcript wanneer geen key is gezet', async () => {
    const buf = Buffer.from('arbitrary-bytes-pretending-to-be-audio');
    const result = await transcribeAudio(buf);
    expect(result.mocked).toBe(true);
    expect(result.text).toBe(MOCK_TRANSCRIPT_NL);
    expect(result.text).toMatch(/sollicitatie|interview|ervaring|engineer/i);
    expect(result.language).toBe('nl');
    expect(result.duration_seconds).toBeGreaterThan(0);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('respecteert language-hint in mock-mode', async () => {
    const buf = Buffer.from('audio-bytes');
    const result = await transcribeAudio(buf, { language: 'en' });
    expect(result.mocked).toBe(true);
    expect(result.language).toBe('en');
  });

  it('throws als de buffer leeg is', async () => {
    const empty = Buffer.alloc(0);
    await expect(transcribeAudio(empty)).rejects.toThrow(/Lege audio-buffer/);
  });

  it('throws als de buffer groter is dan de Whisper-25MB-limiet', async () => {
    // Construct een buffer van WHISPER_MAX_BYTES + 1. Gebruik alloc om
    // memory-snel te zijn; we hoeven niet te schrijven naar de bytes.
    const oversize = Buffer.alloc(WHISPER_MAX_BYTES + 1);
    await expect(transcribeAudio(oversize)).rejects.toThrow(
      /Audio te groot|Whisper-limiet/
    );
  });

  it('staat een buffer exact op de limiet toe (geen throw)', async () => {
    const justUnder = Buffer.alloc(1024); // klein zodat de test snel is
    const result = await transcribeAudio(justUnder);
    expect(result.mocked).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('mocked-output is deterministic — twee calls leveren dezelfde tekst', async () => {
    const a = await transcribeAudio(Buffer.from('a'));
    const b = await transcribeAudio(Buffer.from('b'));
    expect(a.text).toBe(b.text);
    expect(a.text).toBe(MOCK_TRANSCRIPT_NL);
  });
});

describe('whisper.transcribeAudio production-key guard', () => {
  beforeEach(() => {
    _resetWhisperClientForTests();
  });

  it('weigert mock-fallback in production wanneer key ontbreekt', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(transcribeAudio(Buffer.from('x'))).rejects.toThrow(
        /OPENAI_API_KEY ontbreekt in productie/
      );
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
