/**
 * Authentication helpers.
 *
 * SECURITY NOTE: There is intentionally NO silent mock-fallback when the
 * real API is unreachable. Mock authentication is ONLY enabled when the
 * developer explicitly opts in via the env-var:
 *
 *   NEXT_PUBLIC_USE_MOCK_DATA=true
 *
 * In production builds (default), an unreachable API MUST result in a
 * surfaced error to the user — never a silent fake login.
 */

const MOCK_TOKEN = "mock-token-dev";

/** True only when the developer explicitly opts into mock-mode via env. */
export const IS_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_DATA === "true";

/** Exposed so UI code can branch on mock-mode without re-reading the env. */
export function isMockMode(): boolean {
  return IS_MOCK;
}

/** Shared constant for explicit dev mock-token paths. */
export const MOCK_DEV_TOKEN = MOCK_TOKEN;

let accessToken: string | null = null;

export function getToken(): string | null {
  if (IS_MOCK) return MOCK_TOKEN;
  if (typeof window === "undefined") return null;
  if (accessToken) return accessToken;
  return sessionStorage.getItem("tf_token");
}

export function setToken(token: string): void {
  accessToken = token;
  if (typeof window !== "undefined") {
    sessionStorage.setItem("tf_token", token);
  }
}

export function clearToken(): void {
  accessToken = null;
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("tf_token");
  }
}

export function isAuthenticated(): boolean {
  if (IS_MOCK) return true;
  return !!getToken();
}
