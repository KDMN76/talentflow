/**
 * EU AI Act compliance — transparency disclosures.
 *
 * Article 13 of the EU AI Act requires high-risk AI systems (recruitment is
 * explicitly classified as high-risk in Annex III) to inform users that AI is
 * being used and that the human user retains the final decision-making
 * authority. Every AI-generated artifact surfaced to a recruiter through the
 * API MUST be labelled with an `ai_disclosure` field carrying this constant.
 */

export const AI_MATCH_DISCLOSURE_NL =
  'Deze match-score is gegenereerd door AI op basis van vacature-tekst en kandidaat-profiel. De recruiter behoudt het finale oordeel. (EU AI Act art. 13)';
