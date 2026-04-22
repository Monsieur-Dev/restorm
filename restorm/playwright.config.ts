import { defineConfig } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

// Define BDD configurations for each test group
const openFolderTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/open-folder/features/**/*.feature',
  steps: ['tests/e2e/bdd/open-folder/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-folder.fixture.ts'],
  outputDir: '.features-gen/open-folder'
})

const fullWorkflowTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/full-workflow/features/**/*.feature',
  steps: ['tests/e2e/bdd/full-workflow/steps/**/*.ts', 'tests/e2e/bdd/fixtures/full-workflow.fixture.ts'],
  outputDir: '.features-gen/full-workflow'
})

const swaggerImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/swagger-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/swagger-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/swagger-import.fixture.ts'],
  outputDir: '.features-gen/swagger-import'
})

const dirtyStateTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/dirty-state/features/**/*.feature',
  steps: ['tests/e2e/bdd/dirty-state/steps/**/*.ts', 'tests/e2e/bdd/fixtures/dirty-state.fixture.ts'],
  outputDir: '.features-gen/dirty-state'
})

// Temporary diagnostic — remove after the auth-modal layout is stable.
const authModalDebugTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/auth-modal-debug/features/**/*.feature',
  steps: ['tests/e2e/bdd/auth-modal-debug/steps/**/*.ts', 'tests/e2e/bdd/fixtures/auth-modal-debug.fixture.ts'],
  outputDir: '.features-gen/auth-modal-debug'
})

// Perf-measurement scenario for the OData / Dynamics import.
// Opt-in: only registered when `RUN_ODATA_DYNAMICS_PERF=1` is set,
// since the scenario hits a real Entra + Dynamics endpoint, takes
// minutes at baseline, and needs a gitignored credentials file
// (`tests/e2e/fixtures/dynamics-creds.json`).
const runOdataDynamicsPerf = process.env['RUN_ODATA_DYNAMICS_PERF'] === '1'
const odataDynamicsImportTestDir = runOdataDynamicsPerf
  ? defineBddConfig({
      features: 'tests/e2e/bdd/odata-dynamics-import/features/**/*.feature',
      steps: ['tests/e2e/bdd/odata-dynamics-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/odata-dynamics-import.fixture.ts'],
      outputDir: '.features-gen/odata-dynamics-import'
    })
  : null

/**
 * Playwright configuration for Electron E2E tests using playwright-bdd.
 * Each test group has its own project with a dedicated fixture.
 */
export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  /* Timeouts */
  timeout: 120 * 1000,
  expect: {
    timeout: 10000
  },

  /* Run tests in files in parallel */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Single worker for Electron tests */
  workers: 1,

  /* Reporter */
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }]
  ],

  /* Projects for each test group */
  projects: [
    {
      name: 'open-folder',
      testDir: openFolderTestDir
    },
    {
      name: 'full-workflow',
      testDir: fullWorkflowTestDir
    },
    {
      name: 'swagger-import',
      testDir: swaggerImportTestDir
    },
    {
      name: 'dirty-state',
      testDir: dirtyStateTestDir
    },
    {
      name: 'auth-modal-debug',
      testDir: authModalDebugTestDir
    },
    ...(odataDynamicsImportTestDir
      ? [
          {
            name: 'odata-dynamics-import',
            testDir: odataDynamicsImportTestDir,
            timeout: 10 * 60 * 1000 // 10 min — 10k-route import is slow (baseline)
          }
        ]
      : [])
  ]
})
