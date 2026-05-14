import type { Page } from '@playwright/test';

/**
 * Drop the mock dev token into sessionStorage on every navigation so
 * protected routes treat the user as authenticated. The dashboard layout
 * checks `sessionStorage.tf_token` (or sees `NEXT_PUBLIC_USE_MOCK_DATA=true`)
 * and short-circuits the redirect to /login.
 */
export async function authenticate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('tf_token', 'mock-token-dev');
    } catch {
      /* sessionStorage may not be ready on some early about:blank pages */
    }
  });
}
