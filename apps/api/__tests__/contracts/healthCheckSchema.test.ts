import { describe, it, expect } from 'vitest';
import { HealthCheckSchema } from '@talentflow/contracts';

/**
 * Sub-fase 2A — proof-of-concept dat het shared `HealthCheckSchema` daadwerkelijk
 * importeerbaar is vanuit `apps/api` via de tsconfig-paths mapping én dat het
 * **fail-fast** afwijkt van verkeerde response-shapes. Dit bewijst dat als
 * backend en frontend later met hetzelfde schema werken, drift onmiddellijk
 * zichtbaar wordt — geen silent passthrough zoals voor 2026-05-15 het geval was.
 */

describe('@talentflow/contracts — HealthCheckSchema (fail-fast PoC)', () => {
  it('accepteert een correct gevormd HealthCheck-payload', () => {
    const valid = {
      status: 'ok' as const,
      timestamp: '2026-05-17T14:30:00.000Z',
      uptime_seconds: 123,
    };

    const parsed = HealthCheckSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it('accepteert ook status="degraded"', () => {
    const parsed = HealthCheckSchema.parse({
      status: 'degraded',
      timestamp: '2026-05-17T14:30:00.000Z',
      uptime_seconds: 0,
    });
    expect(parsed.status).toBe('degraded');
  });

  it('WIJST AF: status="broken" (niet in enum)', () => {
    const wrong = {
      status: 'broken',
      timestamp: '2026-05-17T14:30:00.000Z',
      uptime_seconds: 123,
    };

    expect(() => HealthCheckSchema.parse(wrong)).toThrowError(/status/);

    const result = HealthCheckSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toEqual(['status']);
      expect(issue.code).toBe('invalid_enum_value');
    }
  });

  it('WIJST AF: timestamp zonder timezone (geen ISO 8601)', () => {
    const wrong = {
      status: 'ok',
      timestamp: '2026-05-17 14:30:00', // geen T-separator, geen TZ
      uptime_seconds: 0,
    };

    const result = HealthCheckSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['timestamp']);
    }
  });

  it('WIJST AF: uptime_seconds negatief', () => {
    const wrong = {
      status: 'ok',
      timestamp: '2026-05-17T14:30:00.000Z',
      uptime_seconds: -1,
    };

    const result = HealthCheckSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['uptime_seconds']);
    }
  });

  it('WIJST AF: uptime_seconds als float (niet int)', () => {
    const wrong = {
      status: 'ok',
      timestamp: '2026-05-17T14:30:00.000Z',
      uptime_seconds: 12.5,
    };

    const result = HealthCheckSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['uptime_seconds']);
    }
  });

  it('WIJST AF: ontbrekend uptime_seconds veld', () => {
    const wrong = {
      status: 'ok',
      timestamp: '2026-05-17T14:30:00.000Z',
    };

    const result = HealthCheckSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['uptime_seconds']);
    }
  });
});
