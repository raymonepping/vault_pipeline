// playwright.config.ts: the live stack, a real browser, nothing mocked.
import { defineConfig, devices } from '@playwright/test';
import { labCaSpkiArg, urls } from './helpers/env';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // one lab: acts change shared state
  timeout: 180_000, // an answer from the CPU model takes up to half a minute
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: urls.web,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: [labCaSpkiArg()] },
  },
});
