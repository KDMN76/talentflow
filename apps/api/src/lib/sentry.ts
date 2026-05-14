/**
 * Sentry initialisation for the TalentFlow API.
 *
 * MUST be imported and `initSentry()` called BEFORE any other module that
 * could throw during startup — Sentry's auto-instrumentation hooks need to
 * load first to wrap http/express/etc.
 *
 * Sentry v8 API change: the old `Sentry.Handlers.requestHandler` /
 * `Sentry.Handlers.errorHandler` middlewares are gone. The current approach
 * is to call `Sentry.init(...)` early and then call
 * `Sentry.setupExpressErrorHandler(app)` after all routes are mounted.
 * Request-context capture happens automatically via the OpenTelemetry-based
 * `httpIntegration` / `expressIntegration` (loaded by default).
 *
 * In development without `SENTRY_DSN_API` we no-op silently (`initSentry`
 * returns without calling `Sentry.init`). In production we log a warning so
 * ops can spot a missing DSN config.
 */

import * as Sentry from '@sentry/node';
import type { Integration } from '@sentry/core';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN_API;
  if (!dsn) {
    if (process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        '[sentry] SENTRY_DSN_API ontbreekt in productie — errors worden niet gereporteerd'
      );
    }
    initialized = true; // mark to avoid repeated warns
    return;
  }
  // Lazy-load the native profiler so Node.js versions without a prebuilt
  // binary (e.g. Node 24 in local dev) don't crash on `import`. Type comes
  // from `@sentry/core` because `@sentry/node` v8+ no longer re-exports it.
  const integrations: Integration[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profiling = require('@sentry/profiling-node') as { nodeProfilingIntegration: () => Integration };
    integrations.push(profiling.nodeProfilingIntegration());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] profiling-node niet geladen — profielen worden niet verzonden:', (err as Error).message);
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations,
    beforeSend(event) {
      // Strip JWT-bearer tokens, cookies en wachtwoorden uit gemeten payloads.
      // Sentry's defaults strippen sommige PII niet automatisch — recruiters
      // kunnen kandidaten-email-adressen op queryparams hebben staan, en die
      // willen we niet centraliseren in een externe SaaS.
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        delete headers.authorization;
        delete headers.Authorization;
        delete headers.cookie;
        delete headers.Cookie;
        delete headers['x-api-key'];
      }
      // Verwijder body-velden die geheim zijn (login, register).
      if (event.request?.data && typeof event.request.data === 'object') {
        const body = event.request.data as Record<string, unknown>;
        if ('password' in body) body.password = '[redacted]';
        if ('password_hash' in body) body.password_hash = '[redacted]';
        if ('token' in body) body.token = '[redacted]';
        if ('refresh_token' in body) body.refresh_token = '[redacted]';
      }
      return event;
    },
  });
  initialized = true;
}

export { Sentry };
