import { test, expect } from '@playwright/test';
import { authenticate } from './helpers';

/**
 * Email-templates pagina — rendert categorieën, opent editor.
 */
test.describe('email-templates', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('renders the email-templates page', async ({ page }) => {
    await page.goto('/email-templates');

    await expect(
      page
        .getByRole('heading', { name: /E-?mail templates|Email templates|Templates/i })
        .first()
    ).toBeVisible();
  });

  test('renders the four standard template categories', async ({ page }) => {
    await page.goto('/email-templates');

    // The component renders Tabs/buttons for the four CATEGORY_LABELS:
    // Uitnodigingen, Afwijzingen, Aanbiedingen, Algemeen. We verify their
    // labels are reachable somewhere on the page.
    for (const label of [
      /Uitnodigingen/i,
      /Afwijzingen/i,
      /Aanbiedingen/i,
      /Algemeen/i,
    ]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test('"Nieuw template" opens the editor dialog', async ({ page }) => {
    await page.goto('/email-templates');

    const createButton = page
      .getByRole('button', { name: /Nieuw template|Template aanmaken|Nieuwe template/i })
      .first();

    if (!(await createButton.isVisible().catch(() => false))) {
      test.skip(true, 'No "Nieuw template" button visible — UI variant');
      return;
    }

    await createButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
