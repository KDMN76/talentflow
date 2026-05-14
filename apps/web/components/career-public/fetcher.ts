/**
 * Server-side fetchers for the public career-page renderer — Sprint Q2.2.
 *
 * SSR can't use the React-Query hooks from `hooks/useCareerPages.ts`
 * (those are client-only and ship a mock fallback that would leak fake
 * data to candidates). These fetchers go straight to the public REST
 * endpoints with `fetch()` so we can leverage Next's request memoization
 * and revalidate cache.
 *
 * On failure we return `null` and let the caller decide whether to
 * `notFound()` or render a graceful "temporarily unavailable" screen —
 * we explicitly do NOT fall back to mock data here (security: candidates
 * should see a clean error before they see fake jobs).
 */

import type {
  PublicCareerPage,
  PublicJob,
  PublicJobForm,
} from "./types";

/**
 * Cache lifetime for public career-page fetches. 60s is short enough that
 * tenant edits surface within a minute, long enough that a viral share of
 * a vacancy doesn't hammer the API.
 */
const REVALIDATE_SECONDS = 60;

/**
 * Backend base URL. Defaults to the same `NEXT_PUBLIC_API_URL` that the
 * client uses, but server-side we may need an internal URL — fall back
 * to `INTERNAL_API_URL` if set so SSR can talk to the API over the
 * docker network without going through the public domain.
 */
function apiBaseUrl(): string {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000/api"
  );
}

interface FetchOptions {
  /** Pass-through Host header so the API can resolve custom domains. */
  hostHeader?: string;
  /** Override revalidate window. */
  revalidate?: number;
}

async function publicFetch<T>(
  path: string,
  opts: FetchOptions = {}
): Promise<T | null> {
  const url = `${apiBaseUrl().replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      headers: opts.hostHeader ? { host: opts.hostHeader } : undefined,
      next: { revalidate: opts.revalidate ?? REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    // Network blip / DNS / connection refused — caller decides UX.
    return null;
  }
}

export async function fetchCareerPageBySlug(
  slug: string,
  opts: FetchOptions = {}
): Promise<PublicCareerPage | null> {
  if (!slug) return null;
  return publicFetch<PublicCareerPage>(
    `/career-pages/public/by-slug/${encodeURIComponent(slug)}`,
    opts
  );
}

export async function fetchCareerPageByDomain(
  host: string,
  opts: FetchOptions = {}
): Promise<PublicCareerPage | null> {
  if (!host) return null;
  return publicFetch<PublicCareerPage>(`/career-pages/public/by-domain`, {
    ...opts,
    hostHeader: host,
  });
}

/**
 * Look up a career page using the incoming Host header. If the host is
 * a TalentFlow-native domain, fall through to the slug-based lookup. If
 * the host is a tenant custom domain, hit the by-domain endpoint.
 *
 * `talentflow.app`, `localhost`, `127.0.0.1` and any subdomain of those
 * are considered native — same allow-list as the API's customDomain
 * middleware.
 */
const NATIVE_HOST_SUFFIXES = ["talentflow.app", "localhost", "127.0.0.1"];

function isNativeHost(host: string): boolean {
  const lower = host.toLowerCase().split(":")[0];
  return NATIVE_HOST_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`)
  );
}

export async function resolveCareerPage(args: {
  slug: string;
  host?: string | null;
}): Promise<PublicCareerPage | null> {
  const { slug, host } = args;
  if (host && !isNativeHost(host)) {
    const byDomain = await fetchCareerPageByDomain(host);
    if (byDomain) return byDomain;
    // If by-domain fails, still attempt slug — the host may be in DNS
    // limbo while a customer migrates and we don't want a hard 404.
  }
  return fetchCareerPageBySlug(slug);
}

export async function fetchJobsForCareerPage(
  careerPageId: string
): Promise<PublicJob[] | null> {
  return publicFetch<PublicJob[]>(
    `/career-pages/public/${encodeURIComponent(careerPageId)}/jobs`
  );
}

export async function fetchJobForm(
  careerPageId: string,
  jobId: string
): Promise<PublicJobForm | null> {
  return publicFetch<PublicJobForm>(
    `/career-pages/public/${encodeURIComponent(
      careerPageId
    )}/jobs/${encodeURIComponent(jobId)}/form`
  );
}

export function applicationSubmitUrl(careerPageId: string): string {
  return `${apiBaseUrl().replace(
    /\/$/,
    ""
  )}/career-pages/public/${encodeURIComponent(careerPageId)}/applications`;
}

export { isNativeHost };
