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

const openapiImportTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/openapi-import/features/**/*.feature',
  steps: ['tests/e2e/bdd/openapi-import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/openapi-import.fixture.ts'],
  outputDir: '.features-gen/openapi-import'
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

const mcpServerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/mcp-server/features/**/*.feature',
  steps: ['tests/e2e/bdd/mcp-server/steps/**/*.ts', 'tests/e2e/bdd/fixtures/mcp-server.fixture.ts'],
  outputDir: '.features-gen/mcp-server'
})

const fullyDocumentedPetstoreTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/fully-documented-petstore/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/fully-documented-petstore/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/fully-documented-petstore.fixture.ts'
  ],
  outputDir: '.features-gen/fully-documented-petstore'
})

const documentationViewerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/documentation-viewer/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/documentation-viewer/steps/**/*.ts',
    'tests/e2e/bdd/fixtures/documentation-viewer.fixture.ts'
  ],
  outputDir: '.features-gen/documentation-viewer'
})

/**
 * Playwright configuration for Electron E2E tests using playwright-bdd.
 * Each test group has its own project with a dedicated fixture.
 */
export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
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

  /* Capture trace + screenshot only on failure so the per-test
   * artefacts dir holds enough context to debug a flake without
   * re-running. Required for the `Read` tool to actually open the
   * end-state screenshot the CLAUDE.md debugging note assumes. */
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  /* Projects for each test group */
  projects: [
    {
      name: 'open-folder',
      testDir: openFolderTestDir
    },
    {
      name: 'full-workflow',
      testDir: fullWorkflowTestDir,
      timeout: 300 * 1000 // 5 min — cumulative scenario covers the full Ajouter submenu and runs near 3 min on slower hosts
    },
    {
      name: 'swagger-import',
      testDir: swaggerImportTestDir
    },
    {
      name: 'openapi-import',
      testDir: openapiImportTestDir
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
    },
    {
      name: 'mcp-server',
      testDir: mcpServerTestDir,
      timeout: 180 * 1000
    },
    {
      name: 'fully-documented-petstore',
      testDir: fullyDocumentedPetstoreTestDir
    },
    {
      name: 'documentation-viewer',
      testDir: documentationViewerTestDir,
      timeout: 180 * 1000
    }
  ]
})
