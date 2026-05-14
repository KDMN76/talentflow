import { describe, it, expect } from 'vitest';
import {
  JOB_BOARD_REGISTRY,
  getConnector,
  listConnectors,
} from '../../src/modules/job-boards/registry';

describe('JOB_BOARD_REGISTRY', () => {
  it('registers linkedin + indeed at minimum', () => {
    expect(JOB_BOARD_REGISTRY.linkedin).toBeDefined();
    expect(JOB_BOARD_REGISTRY.indeed).toBeDefined();
  });

  it('every connector exposes the required JobBoardConnector shape', () => {
    for (const conn of listConnectors()) {
      expect(typeof conn.id).toBe('string');
      expect(conn.id.length).toBeGreaterThan(0);
      expect(typeof conn.displayName).toBe('string');
      expect(['global', 'nl', 'de', 'eu']).toContain(conn.region);
      expect(['oauth2', 'api_key', 'xml_feed', 'none']).toContain(
        conn.authType
      );
      expect(typeof conn.post).toBe('function');
      expect(typeof conn.pollStatus).toBe('function');
      expect(typeof conn.retract).toBe('function');
    }
  });

  it('connector ids are unique', () => {
    const ids = listConnectors().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getConnector returns null for unknown board', () => {
    expect(getConnector('does-not-exist-xyz')).toBeNull();
  });

  it('getConnector returns the connector for a registered id', () => {
    const c = getConnector('linkedin');
    expect(c?.id).toBe('linkedin');
  });

  it('linkedin uses oauth2 + global region', () => {
    expect(JOB_BOARD_REGISTRY.linkedin.authType).toBe('oauth2');
    expect(JOB_BOARD_REGISTRY.linkedin.region).toBe('global');
  });

  it('indeed uses api_key + global region', () => {
    expect(JOB_BOARD_REGISTRY.indeed.authType).toBe('api_key');
    expect(JOB_BOARD_REGISTRY.indeed.region).toBe('global');
  });
});
