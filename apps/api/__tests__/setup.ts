/**
 * Vitest global setup.
 *
 * Loaded before each test file (see vitest.config.ts → setupFiles).
 *
 * Responsibilities:
 *   1. Inject deterministic test env-vars BEFORE any source module loads
 *      (db/pool.ts and auth.service.ts both read process.env at import-time).
 *   2. Mock external SDKs so tests run completely offline.
 *   3. Mock BullMQ Queue so tests do not block waiting for Redis.
 *   4. Mock the `pg` Pool so importing src/db/pool.ts does not actually try
 *      to open a TCP socket. Individual tests can override `pool.connect`
 *      via the dbMock helper.
 */

import { vi } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// 1. Environment — must be set BEFORE module imports happen elsewhere.
// ──────────────────────────────────────────────────────────────────────────────

// Pool requires DATABASE_URL at import-time. Use a clearly-fake URL so any
// accidental real connection attempt fails fast.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:65535/test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'b'.repeat(64);
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:65535';
// Force embeddings to mock-mode (no API key → deterministic mock vectors).
delete process.env.OPENAI_API_KEY;

// ──────────────────────────────────────────────────────────────────────────────
// 2. External SDK mocks — keep tests offline + deterministic.
// ──────────────────────────────────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      create: vi.fn(async () => ({
        model: 'text-embedding-3-small',
        data: [{ embedding: new Array(1536).fill(0) }],
      })),
    };
  },
}));

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: vi.fn(async () => ({ id: 'mock-email-id' })) };
  },
}));

// Sentry — both packages use native bindings; replace with no-ops so the
// modules that pull them in (lib/sentry.ts → audit.ts / aiEvents.ts) can
// load cleanly under coverage instrumentation.
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: (s: unknown) => unknown) => fn({})),
  withScope: vi.fn((fn: (s: unknown) => unknown) => fn({})),
  httpIntegration: vi.fn(),
  expressIntegration: vi.fn(),
}));

vi.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: vi.fn(() => ({})),
}));

// ──────────────────────────────────────────────────────────────────────────────
// 3. BullMQ + ioredis — never block on Redis in unit tests.
// ──────────────────────────────────────────────────────────────────────────────

vi.mock('bullmq', () => {
  return {
    Queue: class MockQueue {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      add = vi.fn(async () => ({ id: 'mock-job-id' }));
      close = vi.fn(async () => undefined);
    },
    Worker: class MockWorker {
      on = vi.fn();
      close = vi.fn(async () => undefined);
    },
  };
});

vi.mock('ioredis', () => {
  return {
    default: class MockIORedis {
      on = vi.fn();
      quit = vi.fn(async () => 'OK');
      disconnect = vi.fn();
    },
  };
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. pg — mock so the Pool constructor doesn't open real sockets. Tests that
//    need DB behaviour use the `dbMock` helper to override `pool.connect`.
// ──────────────────────────────────────────────────────────────────────────────

vi.mock('pg', () => {
  class MockPoolClient {
    query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    release = vi.fn();
  }
  class MockPool {
    on = vi.fn();
    connect = vi.fn(async () => new MockPoolClient());
    end = vi.fn(async () => undefined);
    query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  }
  return {
    Pool: MockPool,
    PoolClient: MockPoolClient,
  };
});

// bcrypt — full real bcrypt is fine but slow in tests. Replace with a fast
// deterministic stub so password hashing/compare doesn't dominate the runtime.
vi.mock('bcrypt', () => {
  const hashes = new Map<string, string>();
  return {
    default: {
      hash: vi.fn(async (pw: string, _rounds: number) => {
        const h = `bcrypt$${pw}`;
        hashes.set(h, pw);
        return h;
      }),
      compare: vi.fn(async (pw: string, hash: string) => hashes.get(hash) === pw || hash === `bcrypt$${pw}`),
    },
    hash: vi.fn(async (pw: string) => `bcrypt$${pw}`),
    compare: vi.fn(async (pw: string, hash: string) => hash === `bcrypt$${pw}`),
  };
});
