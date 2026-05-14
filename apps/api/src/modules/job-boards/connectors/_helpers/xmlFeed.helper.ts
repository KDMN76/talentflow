/**
 * Vacaturebank XML-feed builder.
 *
 * UWV / Nationale Vacaturebank does NOT accept push-API postings — instead
 * the recruiter publishes a public XML feed which UWV scrapes daily. The
 * schema below is the documented "vacatures" feed shape used by werk.nl.
 *
 *   <vacatures>
 *     <vacature>
 *       <id/>                  -- stable string id (we use the job id)
 *       <titel/>                -- title (mandatory)
 *       <omschrijving/>         -- description (CDATA-wrapped, may contain HTML)
 *       <plaats/>               -- city
 *       <werkuren_per_week/>    -- numeric, derived from employment_type
 *       <opleidingsniveau/>     -- 'mbo' | 'hbo' | 'wo' | 'vmbo' | 'onbekend'
 *     </vacature>
 *     ...
 *   </vacatures>
 *
 * Output is plain string — no DOM library — so we don't pull in a heavy
 * dependency for a once-per-5-minutes endpoint. Cached upstream via
 * Cache-Control: public, max-age=300 (see publicFeedRoutes.ts).
 */

import type { NormalizedJob } from '../../types';

/**
 * Escape XML-special characters in element TEXT nodes. Used for short
 * fields like <titel> + <plaats>; long HTML-rich fields go via CDATA.
 */
export function escapeXml(input: string | undefined | null): string {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap a description in CDATA. CDATA cannot contain the literal `]]>` —
 * we split such occurrences across two CDATA sections per XML spec.
 */
export function wrapCdata(input: string | undefined | null): string {
  if (input == null || input === '') return '<![CDATA[]]>';
  // Split occurrences of "]]>" so each ends up across two CDATA blocks.
  const safe = String(input).replace(/]]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

/**
 * Map our normalized employment_type to a "uren per week" approximation.
 * Vacaturebank's schema requires a numeric value; we use the conventional
 * Dutch full-time week (40h) and 50% for part-time.
 */
function hoursPerWeek(job: NormalizedJob): number {
  switch (job.employment_type) {
    case 'part_time':
      return 20;
    case 'temporary':
    case 'contract':
    case 'full_time':
      return 40;
    case 'internship':
      return 32;
    default:
      return 40;
  }
}

/**
 * Heuristic for opleidingsniveau when we don't have a real signal. The
 * downstream consumer (UWV) only validates the enum; "onbekend" is
 * always accepted, so we default to that and let the recruiter override
 * later via custom-fields.
 */
function educationLevel(_job: NormalizedJob): 'vmbo' | 'mbo' | 'hbo' | 'wo' | 'onbekend' {
  return 'onbekend';
}

/**
 * Build the full feed string for a list of jobs. Caller passes already
 * tenant-filtered + status='posted'-filtered jobs. The feed is wrapped in
 * an XML prolog with UTF-8 + a newline-separated body for readability.
 */
export function buildVacaturebankFeedXml(jobs: NormalizedJob[]): string {
  const items = jobs.map((j) => {
    const lines = [
      '  <vacature>',
      `    <id>${escapeXml(j.id)}</id>`,
      `    <titel>${escapeXml(j.title)}</titel>`,
      `    <omschrijving>${wrapCdata(j.description)}</omschrijving>`,
      `    <plaats>${escapeXml(j.location?.city ?? '')}</plaats>`,
      `    <werkuren_per_week>${hoursPerWeek(j)}</werkuren_per_week>`,
      `    <opleidingsniveau>${educationLevel(j)}</opleidingsniveau>`,
      '  </vacature>',
    ];
    return lines.join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<vacatures>',
    ...items,
    '</vacatures>',
    '',
  ].join('\n');
}
