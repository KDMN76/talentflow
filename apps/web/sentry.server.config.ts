/**
 * Sentry initialisation for the Next.js server runtime (Node).
 *
 * Auto-loaded by `withSentryConfig`. Captures uncaught errors thrown in
 * Server Components, route handlers, and getServerSideProps paths.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN_WEB ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
});
