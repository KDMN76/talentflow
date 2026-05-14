import { describe, it, expect } from 'vitest';
import { AI_MATCH_DISCLOSURE_NL } from '../../src/lib/aiDisclosure';

describe('aiDisclosure', () => {
  it('exports the Dutch match-disclosure constant', () => {
    expect(AI_MATCH_DISCLOSURE_NL).toBeDefined();
    expect(typeof AI_MATCH_DISCLOSURE_NL).toBe('string');
    expect(AI_MATCH_DISCLOSURE_NL.length).toBeGreaterThan(50);
  });

  it('mentions the EU AI Act for transparency compliance', () => {
    expect(AI_MATCH_DISCLOSURE_NL).toMatch(/EU AI Act/);
  });

  it('mentions that the recruiter retains the final decision', () => {
    // "finale oordeel" / "recruiter behoudt" — phrasing that signals human override.
    expect(AI_MATCH_DISCLOSURE_NL.toLowerCase()).toMatch(/recruiter|finale|oordeel/);
  });

  it('matches the exact published copy (snapshot to flag accidental edits)', () => {
    expect(AI_MATCH_DISCLOSURE_NL).toMatchInlineSnapshot(
      `"Deze match-score is gegenereerd door AI op basis van vacature-tekst en kandidaat-profiel. De recruiter behoudt het finale oordeel. (EU AI Act art. 13)"`
    );
  });
});
