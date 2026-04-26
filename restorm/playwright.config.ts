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

const odataPetstoreTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/odata-petstore/features/**/*.feature',
  steps: ['tests/e2e/bdd/odata-petstore/steps/**/*.ts', 'tests/e2e/bdd/fixtures/odata-petstore.fixture.ts'],
  outputDir: '.features-gen/odata-petstore'
})

const authLoginTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/auth-login/features/**/*.feature',
  steps: ['tests/e2e/bdd/auth-login/steps/**/*.ts', 'tests/e2e/bdd/fixtures/auth-login.fixture.ts'],
  outputDir: '.features-gen/auth-login'
})

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
      testDir: fullWorkflowTestDir,
      timeout: 180 * 1000 // 3 min — cumulative scenario covers the full Ajouter submenu
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
      name: 'odata-petstore',
      testDir: odataPetstoreTestDir
    },
    {
      name: 'auth-login',
      testDir: authLoginTestDir
    }
  ]
})
