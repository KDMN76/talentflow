/**
 * OpenAPI spec validation — Sprint Q4.1 (Agent KKK).
 *
 * Verifieert dat:
 *   1. De spec genereert (geen registry-fouten).
 *   2. Het document is OpenAPI 3.1.
 *   3. Voldoende endpoints zijn gespec'd (>20 paden).
 *   4. Iedere operation heeft summary + tags.
 *   5. Tags die in operations gebruikt worden, zijn gedeclareerd in `tags`.
 *   6. Security schemes (bearerAuth + apiKey) bestaan.
 *   7. Postman-export valide structuur produceert.
 */

import { describe, it, expect } from 'vitest';
import { getOpenApiSpec, getPostmanCollection } from '../src/lib/openapi';

interface OperationLike {
  summary?: string;
  tags?: string[];
  responses?: Record<string, unknown>;
}

interface SpecLike {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OperationLike>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
  };
  tags?: Array<{ name: string }>;
}

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
]);

describe('OpenAPI spec', () => {
  const spec = getOpenApiSpec() as SpecLike;

  it('generates an OpenAPI 3.1 document', () => {
    expect(spec).toHaveProperty('openapi', '3.1.0');
    expect(spec.info.title).toBe('TalentFlow API');
    expect(spec.info.version).toBeTruthy();
  });

  it('has at least 20 paths registered', () => {
    const pathCount = Object.keys(spec.paths ?? {}).length;
    expect(pathCount).toBeGreaterThan(20);
  });

  it('has at least 50 operations registered', () => {
    let opCount = 0;
    for (const methods of Object.values(spec.paths ?? {})) {
      for (const method of Object.keys(methods)) {
        if (HTTP_METHODS.has(method)) opCount++;
      }
    }
    expect(opCount).toBeGreaterThanOrEqual(50);
  });

  it('every operation has summary + at least one tag', () => {
    const violations: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(method)) continue;
        if (!op.summary) violations.push(`${method.toUpperCase()} ${path} → missing summary`);
        if (!op.tags || op.tags.length === 0) {
          violations.push(`${method.toUpperCase()} ${path} → missing tags`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('every operation has at least one declared response', () => {
    const violations: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(method)) continue;
        if (!op.responses || Object.keys(op.responses).length === 0) {
          violations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('all tags used in operations are declared at root', () => {
    const declared = new Set((spec.tags ?? []).map((t) => t.name));
    const used = new Set<string>();
    for (const methods of Object.values(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(method)) continue;
        for (const t of op.tags ?? []) used.add(t);
      }
    }
    const undeclared = [...used].filter((t) => !declared.has(t));
    expect(undeclared).toEqual([]);
  });

  it('declares Bearer + API-key security schemes', () => {
    const schemes = spec.components?.securitySchemes ?? {};
    expect(schemes).toHaveProperty('bearerAuth');
    expect(schemes).toHaveProperty('apiKey');
  });

  it('exposes auth, candidates, jobs, pipeline, communications, matching, webhooks, reports', () => {
    const paths = Object.keys(spec.paths ?? {});
    const required = [
      '/api/auth/login',
      '/api/candidates',
      '/api/jobs',
      '/api/pipeline/applications',
      '/api/communications/inbox',
      '/api/matching/jobs/{jobId}',
      '/api/webhooks',
      '/api/reports',
    ];
    for (const r of required) {
      expect(paths).toContain(r);
    }
  });
});

describe('Postman export', () => {
  const collection = getPostmanCollection();

  it('produces a Postman 2.1 collection', () => {
    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    );
    expect(collection.info.name).toBe('TalentFlow API');
  });

  it('groups requests in folders', () => {
    expect(collection.item.length).toBeGreaterThan(5);
    for (const folder of collection.item) {
      expect(folder).toHaveProperty('name');
      expect(folder.item.length).toBeGreaterThan(0);
    }
  });

  it('declares baseUrl + accessToken variables', () => {
    const keys = collection.variable.map((v) => v.key);
    expect(keys).toContain('baseUrl');
    expect(keys).toContain('accessToken');
  });
});
