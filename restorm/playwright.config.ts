import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Electron-only E2E tests.
 * No browser projects - tests launch Electron directly via electron.launch().
 */
export default defineConfig({
  testDir: './tests/e2e',
  
  /* Only run Electron tests - tests that use electron.launch() directly */
  testMatch: [
    '**/electron/**/*.spec.ts',
    '**/application/folder-save-operations.spec.ts',
    '**/application/open-folder.spec.ts',
    '**/application/dirty-state.spec.ts',
  ],
  
  /* Timeouts */
  timeout: 120 * 1000,
  expect: {
    timeout: 5000,
  },
  
  /* Run tests in files in parallel */
  fullyParallel: false, // Electron tests should run sequentially
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Single worker for Electron tests */
  workers: 1,
  
  /* Reporter to use - no HTML report auto-open */
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
});
