import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for TalentFlow web E2E.
 *
 * Tests run against a Next.js dev server with mock-mode enabled
 * (NEXT_PUBLIC_USE_MOCK_DATA=true) so we don't need a running API or DB.
 * The web server is started by Playwright when tests start (or reused if
 * already running locally — `reuseExistingServer: !process.env.CI`).
 */
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './__e2e__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_USE_MOCK_DATA: 'true',
      PORT: String(PORT),
    },
  },
});
