/**
 * Shared error taxonomy for job-board connectors.
 *
 * Used by every connector under `src/modules/job-boards/connectors/**`,
 * including LinkedIn + Indeed (owned by Agent QQQ). Mapping convention:
 *
 *   - `JobBoardAuthError`       → 401/403 from upstream → token refresh or
 *                                 manual re-auth required. Worker SHOULD NOT
 *                                 retry transparently.
 *   - `JobBoardClientError`     → 4xx other than 401/403 (validation,
 *                                 quota, malformed payload). Surface error to
 *                                 user; do NOT retry.
 *   - `JobBoardTransientError`  → 5xx, timeouts, rate-limit-without-retry-after,
 *                                 network errors. Worker may retry with
 *                                 exponential backoff.
 *
 * `cause` is preserved so logs/Sentry can surface the underlying axios error.
 */

export class JobBoardAuthError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'JobBoardAuthError';
    this.cause = cause;
  }
}

export class JobBoardClientError extends Error {
  override readonly cause?: unknown;
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message);
    this.name = 'JobBoardClientError';
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export class JobBoardTransientError extends Error {
  override readonly cause?: unknown;
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message);
    this.name = 'JobBoardTransientError';
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

/**
 * Map an axios-shaped HTTP error to one of our typed errors.
 *
 * Consumers call this in their catch-blocks so worker retry policy is
 * uniform across connectors:
 *   try { await axios.post(...) }
 *   catch (e) { throw mapHttpError(e); }
 */
export function mapHttpError(err: unknown): Error {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string; code?: string };
  const status = e.response?.status;
  const msg = e.message ?? 'Upstream request failed';

  if (status === 401 || status === 403) {
    return new JobBoardAuthError(`Authentication failed (${status})`, err);
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new JobBoardClientError(`Upstream client error (${status}): ${msg}`, status, err);
  }
  if (status !== undefined && status >= 500) {
    return new JobBoardTransientError(`Upstream server error (${status})`, status, err);
  }
  // Network / timeout / DNS / ECONNRESET — treat as transient.
  return new JobBoardTransientError(`Network error: ${msg}`, undefined, err);
}
