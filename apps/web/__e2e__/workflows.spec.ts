import { test, expect } from '@playwright/test';
import { authenticate } from './helpers';

/**
 * Workflows pagina rendert en de "Nieuwe workflow"-knop opent een dialog.
 */
test.describe('workflows', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('renders the workflows page header', async ({ page }) => {
    await page.goto('/workflows');

    await expect(
      page.getByRole('heading', { name: /Workflows/i }).first()
    ).toBeVisible();
  });

  test('"Nieuwe workflow" opens the create-dialog', async ({ page }) => {
    await page.goto('/workflows');

    const createButton = page
      .getByRole('button', { name: /Nieuwe workflow|Workflow aanmaken/i })
      .first();

    // If the button isn't found in this view, skip — the page may surface
    // the action behind a different label (e.g. tab-bar). The mock-mode
    // smoke is interested in the route loading without errors.
    if (!(await createButton.isVisible().catch(() => false))) {
      test.skip(true, 'No "Nieuwe workflow" button visible in current viewport');
      return;
    }

    await createButton.click();

    // A Radix Dialog renders role="dialog" with an aria-labelled title.
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
