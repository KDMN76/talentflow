/**
 * Webhook signature tests — Sprint Q4.1 (Agent LLL).
 *
 * Verifieert dat:
 *   - signPayload deterministisch hetzelfde resultaat geeft voor dezelfde input.
 *   - Verschillende secrets verschillende signatures opleveren.
 *   - Verschillende bodies verschillende signatures opleveren.
 *   - De signature het verwachte `sha256=<hex>`-formaat heeft.
 *   - Receiver kan de signature verifiëren met dezelfde secret + body.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { signPayload } from '../../src/modules/webhooks/deliveries.service';

describe('signPayload (HMAC-SHA256)', () => {
  it('produceert deterministisch dezelfde signature', () => {
    const a = signPayload('s3cr3t', '{"hello":"world"}');
    const b = signPayload('s3cr3t', '{"hello":"world"}');
    expect(a).toBe(b);
  });

  it('formaat is `sha256=<64-hex>`', () => {
    const sig = signPayload('s3cr3t', 'body');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('verschillende secrets → verschillende signatures', () => {
    const a = signPayload('secret-a', 'body');
    const b = signPayload('secret-b', 'body');
    expect(a).not.toBe(b);
  });

  it('verschillende bodies → verschillende signatures', () => {
    const a = signPayload('secret', 'body-1');
    const b = signPayload('secret', 'body-2');
    expect(a).not.toBe(b);
  });

  it('matcht een handmatig berekende HMAC-SHA256', () => {
    const secret = 'test-secret';
    const body = '{"event":"candidate.created"}';
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(signPayload(secret, body)).toBe(expected);
  });

  it('UTF-8-bytes worden correct gehashed (emoji)', () => {
    const sig = signPayload('s', '{"name":"Renée 🎉"}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    // Stable cross-runtime check
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', 's').update('{"name":"Renée 🎉"}', 'utf8').digest('hex');
    expect(sig).toBe(expected);
  });

  it('receiver kan signature verifiëren met timingSafeEqual', () => {
    const secret = crypto.randomBytes(20).toString('hex');
    const body = JSON.stringify({ id: 1, t: Date.now() });
    const sig = signPayload(secret, body);
    const [scheme, hex] = sig.split('=');
    expect(scheme).toBe('sha256');
    const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest();
    const provided = Buffer.from(hex, 'hex');
    expect(provided.length).toBe(computed.length);
    expect(crypto.timingSafeEqual(provided, computed)).toBe(true);
  });
});
