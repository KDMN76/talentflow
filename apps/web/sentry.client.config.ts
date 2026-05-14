/**
 * Sentry initialisation for the browser bundle.
 *
 * Auto-loaded by `withSentryConfig` in next.config.mjs. Without a DSN we
 * effectively no-op (Sentry.init met undefined DSN doet niets schadelijks),
 * zodat dev-omgevingen zonder Sentry-credentials gewoon werken.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
  // Lager dan API; browser-frequenties zijn doorgaans hoger dus 0.05 voorkomt
  // ruis in Replay-quota tijdens early launches.
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.0,
});
