/**
 * Sentry initialisation for the Edge runtime (middleware, edge route handlers).
 *
 * Auto-loaded by `withSentryConfig`. Edge runs in a constrained
 * V8-isolate-style environment — Sentry strips Node-only integrations.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN_WEB ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
});
