/**
 * Vacaturebank XML-feed builder tests — Sprint Q4.3 (Agent RRR).
 */

import { describe, it, expect } from 'vitest';
import {
  buildVacaturebankFeedXml,
  escapeXml,
  wrapCdata,
} from '../../../src/modules/job-boards/connectors/_helpers/xmlFeed.helper';
import type { NormalizedJob } from '../../../src/modules/job-boards/types';

describe('escapeXml', () => {
  it('escapes the five XML predefined entities', () => {
    expect(escapeXml(`<a href="x" id='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; id=&apos;y&apos;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('returns empty string for null/undefined', () => {
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
  });
});

describe('wrapCdata', () => {
  it('wraps simple text in CDATA', () => {
    expect(wrapCdata('hello world')).toBe('<![CDATA[hello world]]>');
  });

  it('splits "]]>" sequences across two CDATA sections', () => {
    expect(wrapCdata('foo ]]> bar')).toBe('<![CDATA[foo ]]]]><![CDATA[> bar]]>');
  });

  it('returns empty CDATA for null/empty', () => {
    expect(wrapCdata('')).toBe('<![CDATA[]]>');
    expect(wrapCdata(null)).toBe('<![CDATA[]]>');
  });
});

describe('buildVacaturebankFeedXml', () => {
  it('emits the XML prolog + <vacatures> root for empty input', () => {
    const xml = buildVacaturebankFeedXml([]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<vacatures>');
    expect(xml).toContain('</vacatures>');
  });

  it('emits one <vacature> block per job', () => {
    const jobs: NormalizedJob[] = [
      { id: '1', title: 'Job One', description: 'd1', location: { city: 'Amsterdam' } },
      { id: '2', title: 'Job Two', description: 'd2', location: { city: 'Rotterdam' } },
    ];
    const xml = buildVacaturebankFeedXml(jobs);
    const matches = xml.match(/<vacature>/g);
    expect(matches?.length).toBe(2);
    expect(xml).toContain('<id>1</id>');
    expect(xml).toContain('<id>2</id>');
    expect(xml).toContain('<titel>Job One</titel>');
    expect(xml).toContain('<plaats>Amsterdam</plaats>');
    expect(xml).toContain('<plaats>Rotterdam</plaats>');
  });

  it('escapes special characters in <titel> + <plaats>', () => {
    const jobs: NormalizedJob[] = [
      { id: 'x', title: 'A & B <c>', description: 'plain', location: { city: 'O\'Hare' } },
    ];
    const xml = buildVacaturebankFeedXml(jobs);
    expect(xml).toContain('<titel>A &amp; B &lt;c&gt;</titel>');
    expect(xml).toContain('<plaats>O&apos;Hare</plaats>');
  });

  it('wraps description in CDATA so HTML is preserved', () => {
    const jobs: NormalizedJob[] = [
      { id: 'x', title: 'T', description: '<p>Hello <b>world</b></p>' },
    ];
    const xml = buildVacaturebankFeedXml(jobs);
    expect(xml).toContain('<![CDATA[<p>Hello <b>world</b></p>]]>');
  });

  it('maps employment_type to a numeric werkuren_per_week', () => {
    const jobs: NormalizedJob[] = [
      { id: '1', title: 'T', description: 'D', employment_type: 'full_time' },
      { id: '2', title: 'T', description: 'D', employment_type: 'part_time' },
      { id: '3', title: 'T', description: 'D', employment_type: 'internship' },
    ];
    const xml = buildVacaturebankFeedXml(jobs);
    expect(xml).toContain('<werkuren_per_week>40</werkuren_per_week>');
    expect(xml).toContain('<werkuren_per_week>20</werkuren_per_week>');
    expect(xml).toContain('<werkuren_per_week>32</werkuren_per_week>');
  });

  it('always includes <opleidingsniveau> (defaults to "onbekend")', () => {
    const jobs: NormalizedJob[] = [{ id: '1', title: 'T', description: 'D' }];
    const xml = buildVacaturebankFeedXml(jobs);
    expect(xml).toContain('<opleidingsniveau>onbekend</opleidingsniveau>');
  });
});
