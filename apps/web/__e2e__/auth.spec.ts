import { test, expect } from '@playwright/test';

/**
 * Auth flow — login page rendering, validation, mock-mode redirect.
 *
 * In mock-mode (NEXT_PUBLIC_USE_MOCK_DATA=true), submitting the login form
 * with valid input bypasses the real API and routes straight to /dashboard.
 */
test.describe('login page', () => {
  test('renders the login form with all required fields', async ({ page }) => {
    await page.goto('/login');

    // Page heading exists (Dutch UI)
    await expect(
      page.getByRole('heading', { name: /Welkom terug/i })
    ).toBeVisible();

    // All three required form inputs are present.
    await expect(page.getByLabel('Workspace')).toBeVisible();
    await expect(page.getByLabel('E-mailadres')).toBeVisible();
    await expect(page.getByLabel('Wachtwoord')).toBeVisible();

    // Submit button is present.
    await expect(page.getByRole('button', { name: /Inloggen/i })).toBeVisible();
  });

  test('shows validation messages for an empty submission', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: /Inloggen/i }).click();

    // At least one of the field-level error messages from zodResolver
    // should appear. We assert on the workspace one because it's the
    // simplest required-string rule.
    await expect(
      page.getByText(/Workspace is verplicht|Ongeldig e-mailadres|minimaal 6 tekens/i).first()
    ).toBeVisible();
  });

  test('mock-mode login submits successfully and redirects to /dashboard', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Workspace').fill('acme');
    await page.getByLabel('E-mailadres').fill('admin@acme.nl');
    await page.getByLabel('Wachtwoord').fill('password123');

    await page.getByRole('button', { name: /Inloggen/i }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/dashboard/);
  });
});
