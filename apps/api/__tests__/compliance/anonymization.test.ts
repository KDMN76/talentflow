/**
 * Anonymization library tests — Sprint Q2.3.
 *
 * Pure unit-tests over `anonymizeCandidate` en `stripPiiFromText`.
 * Geen DB-mocks nodig — dit is een pure functie.
 */

import { describe, it, expect } from 'vitest';
import {
  anonymizeCandidate,
  stripPiiFromText,
  DEFAULT_ANONYMIZATION_RULES,
  type AnonymizationRules,
} from '../../src/lib/anonymization';

const fullRules: AnonymizationRules = { ...DEFAULT_ANONYMIZATION_RULES };
const onlyPhone: AnonymizationRules = {
  ...DEFAULT_ANONYMIZATION_RULES,
  hide_name: false,
  hide_email: false,
  hide_phone: true,
  hide_photo: false,
  hide_address: false,
  hide_birthdate: false,
  hide_nationality: false,
  hide_gender: false,
  hide_linkedin: false,
  hide_education_dates: false,
};

describe('anonymizeCandidate — naam', () => {
  it('vervangt name door "Kandidaat #<reference>"', () => {
    const out = anonymizeCandidate(
      {
        id: 'c1',
        candidate_reference: 'ABC1234',
        name: 'Sofia Vermeer',
        first_name: 'Sofia',
        last_name: 'Vermeer',
      },
      fullRules
    );
    expect(out.name).toBe('Kandidaat #ABC1234');
    expect(out.first_name).toBe('Kandidaat');
    expect(out.last_name).toBe('#ABC1234');
  });

  it('valt terug op id als reference ontbreekt', () => {
    const out = anonymizeCandidate(
      { id: 'c1', name: 'Sofia' },
      fullRules
    );
    expect(out.name).toBe('Kandidaat #c1');
  });

  it('houdt naam intact als hide_name = false', () => {
    const out = anonymizeCandidate(
      { id: 'c1', name: 'Sofia' },
      onlyPhone
    );
    expect(out.name).toBe('Sofia');
  });
});

describe('anonymizeCandidate — contactgegevens', () => {
  it('zet email/phone/address/birthdate/nationalities op null bij volle regels', () => {
    const out = anonymizeCandidate(
      {
        id: 'c1',
        email: 'sofia@example.nl',
        phone: '+31612345678',
        address_line1: 'Hoofdstraat 1',
        address_city: 'Amsterdam',
        address_postal_code: '1011 AA',
        birthdate: '1990-01-01',
        gender: 'female',
        nationalities: ['NL'],
      },
      fullRules
    );
    expect(out.email).toBeNull();
    expect(out.phone).toBeNull();
    expect(out.address_line1).toBeNull();
    expect(out.address_city).toBeNull();
    expect(out.address_postal_code).toBeNull();
    expect(out.birthdate).toBeNull();
    expect(out.gender).toBeNull();
    expect(out.nationalities).toBeNull();
  });

  it('behoudt address_country (geografische match is geen PII)', () => {
    const out = anonymizeCandidate(
      { id: 'c1', address_country: 'Nederland' },
      fullRules
    );
    expect(out.address_country).toBe('Nederland');
  });

  it('strip phone alleen als hide_phone true is', () => {
    const out = anonymizeCandidate(
      {
        id: 'c1',
        email: 'a@b.nl',
        phone: '+31612345678',
      },
      onlyPhone
    );
    expect(out.phone).toBeNull();
    expect(out.email).toBe('a@b.nl');
  });
});

describe('anonymizeCandidate — description redaction', () => {
  it('strip email + phone + linkedin URL uit description', () => {
    const out = anonymizeCandidate(
      {
        id: 'c1',
        candidate_reference: 'AAA',
        name: 'Sofia',
        first_name: 'Sofia',
        email: 'sofia@example.nl',
        phone: '+31612345678',
        description:
          'Hoi, ik ben Sofia. Mail mij op sofia@example.nl of bel +31 612 345 678. ' +
          'LinkedIn: https://linkedin.com/in/sofia-vermeer',
      },
      fullRules
    );
    expect(out.description).not.toContain('sofia@example.nl');
    expect(out.description).not.toContain('+31612345678');
    expect(out.description).not.toContain('linkedin.com');
    expect(out.description).toContain('[REDACTED]');
  });

  it('respecteert hide_linkedin=false', () => {
    const rules: AnonymizationRules = { ...fullRules, hide_linkedin: false };
    const out = anonymizeCandidate(
      {
        id: 'c1',
        description: 'Profile: https://linkedin.com/in/me',
      },
      rules
    );
    expect(out.description).toContain('linkedin.com');
  });

  it('produceert immutable output — input wordt niet gemuteerd', () => {
    const input = {
      id: 'c1',
      name: 'Sofia',
      email: 'sofia@example.nl',
    };
    const before = JSON.stringify(input);
    anonymizeCandidate(input, fullRules);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('stripPiiFromText', () => {
  it('verwijdert email, telefoon en LinkedIn met defaults', () => {
    const text =
      'Contact me at sofia@example.nl or +31 6 1234 5678 or via https://linkedin.com/in/sofia.';
    const out = stripPiiFromText(text, fullRules);
    expect(out).not.toContain('sofia@example.nl');
    expect(out).not.toContain('5678');
    expect(out).not.toContain('linkedin.com');
  });

  it('verwijdert NL-postcode 1234 AB', () => {
    const out = stripPiiFromText('Adres: 1011 AA Amsterdam', fullRules);
    expect(out).not.toContain('1011 AA');
  });

  it('verwijdert geboortedatums in dd-mm-yyyy en yyyy-mm-dd', () => {
    const out = stripPiiFromText(
      'Geboren 01-01-1990 of 1990-01-01.',
      fullRules
    );
    expect(out).not.toContain('1990');
  });

  it('strip de naam van de kandidaat als literal', () => {
    const out = stripPiiFromText(
      'Sofia Vermeer is een goede kandidaat. Sofia werkte eerder bij KDMN.',
      fullRules,
      { name: 'Sofia Vermeer', first_name: 'Sofia', last_name: 'Vermeer' }
    );
    expect(out).not.toContain('Sofia');
    expect(out).not.toContain('Vermeer');
  });

  it('skipt te-korte literals (< 3 chars) om ruis te vermijden', () => {
    const out = stripPiiFromText(
      'Mij heet An.',
      fullRules,
      { name: 'An', first_name: 'An' }
    );
    expect(out).toContain('An'); // niet vervangen
  });

  it('laat tekst onaangeraakt als alle rules false zijn', () => {
    const allFalse: AnonymizationRules = {
      hide_name: false,
      hide_email: false,
      hide_phone: false,
      hide_photo: false,
      hide_address: false,
      hide_birthdate: false,
      hide_nationality: false,
      hide_gender: false,
      hide_linkedin: false,
      hide_education_dates: false,
    };
    const text = 'sofia@example.nl en 06-12345678.';
    expect(stripPiiFromText(text, allFalse)).toBe(text);
  });
});

describe('DEFAULT_ANONYMIZATION_RULES', () => {
  it('staat alle hide_* op true', () => {
    for (const v of Object.values(DEFAULT_ANONYMIZATION_RULES)) {
      expect(v).toBe(true);
    }
  });
});
