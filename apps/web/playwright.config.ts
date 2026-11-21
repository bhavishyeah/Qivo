import { defineConfig } from '@playwright/test'

// Smoke E2E suite. Runs against the Vite dev server with a mocked API
// (see e2e/helpers/mockApi.ts), so no Postgres or API process is needed.
// Uses the system Chrome, so no browser download is required.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Traces and screenshots go to test-results/ (gitignored) unless E2E_OUTPUT_DIR is set.
  outputDir: process.env.E2E_OUTPUT_DIR ?? 'test-results',
  reporter: [['list']],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The Vite dev server compiles on first hit, so too many workers only add contention.
  workers: 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Keeps the OS dark preference out of the picture unless a test sets it.
    colorScheme: 'light',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'pnpm exec vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Same-origin API calls, which the tests intercept with page.route.
    env: { VITE_API_URL: '' },
  },
})
