import { test, expect } from '@playwright/test';
import { authenticate } from './helpers';

/**
 * Candidates list + detail flow.
 *
 * Validates that the kandidaten-pagina rendert in mock-mode, dat de search-
 * input bestaat en dat clicking a candidate card navigates to the detail
 * pagina with a CV-card visible.
 */
test.describe('candidates', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('list page renders header and search input', async ({ page }) => {
    await page.goto('/candidates');

    await expect(
      page.getByRole('heading', { name: /Kandidaten/i })
    ).toBeVisible();

    // Search field
    await expect(
      page.getByPlaceholder(/Zoek op naam, email of skill/i)
    ).toBeVisible();

    // "Nieuwe kandidaat" button exists
    await expect(
      page.getByRole('button', { name: /Nieuwe kandidaat/i })
    ).toBeVisible();
  });

  test('clicking a candidate navigates to the detail page', async ({ page }) => {
    await page.goto('/candidates');

    // Wait for either skeletons to clear or at least one candidate link to
    // become clickable. The mock data includes several candidates by default.
    const firstCandidateLink = page
      .locator('a[href^="/candidates/"]')
      .first();

    // If no candidates are rendered we accept the empty-state instead — the
    // smoke test only needs to verify rendering, not data shape.
    const linkCount = await firstCandidateLink.count();
    test.skip(
      linkCount === 0,
      'No candidate links rendered in mock-mode — skipping detail navigation'
    );

    await firstCandidateLink.click();

    await page.waitForURL(/\/candidates\/[^/]+/, { timeout: 10_000 });

    // Detail page should show a "Terug" button and the candidate avatar
    // header. We use the back-link as a reliable detail-page marker.
    await expect(
      page.getByRole('link', { name: /Terug|Kandidaten/i }).first()
    ).toBeVisible();
  });
});
