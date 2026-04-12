import { defineConfig } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

// Define BDD configurations for each test group
const handlebarsTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/handlebars/features/**/*.feature',
  steps: ['tests/e2e/bdd/handlebars/steps/**/*.ts', 'tests/e2e/bdd/fixtures/handlebars.fixture.ts'],
  outputDir: '.features-gen/handlebars'
})

const searchTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/search/features/**/*.feature',
  steps: ['tests/e2e/bdd/search/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-file.fixture.ts'],
  outputDir: '.features-gen/search'
})

const openFolderTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/open-folder/features/**/*.feature',
  steps: ['tests/e2e/bdd/open-folder/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-folder.fixture.ts'],
  outputDir: '.features-gen/open-folder'
})

const dirtyStateTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/dirty-state/features/**/*.feature',
  steps: ['tests/e2e/bdd/dirty-state/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-file.fixture.ts'],
  outputDir: '.features-gen/dirty-state'
})

const saveOperationsTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/save-operations/features/**/*.feature',
  steps: ['tests/e2e/bdd/save-operations/steps/**/*.ts', 'tests/e2e/bdd/fixtures/save-operations.fixture.ts'],
  outputDir: '.features-gen/save-operations'
})

const importTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/import/features/**/*.feature',
  steps: ['tests/e2e/bdd/import/steps/**/*.ts', 'tests/e2e/bdd/fixtures/import.fixture.ts'],
  outputDir: '.features-gen/import'
})

const iconChangeTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/icon-change/features/**/*.feature',
  steps: ['tests/e2e/bdd/icon-change/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-file.fixture.ts'],
  outputDir: '.features-gen/icon-change'
})

const sidebarSyncTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/sidebar-sync/features/**/*.feature',
  steps: ['tests/e2e/bdd/sidebar-sync/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-file.fixture.ts'],
  outputDir: '.features-gen/sidebar-sync'
})

const navigationTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/navigation/features/**/*.feature',
  steps: ['tests/e2e/bdd/navigation/steps/**/*.ts', 'tests/e2e/bdd/fixtures/petstore-file.fixture.ts'],
  outputDir: '.features-gen/navigation'
})

const windowStateTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/window-state/features/**/*.feature',
  steps: ['tests/e2e/bdd/window-state/steps/**/*.ts', 'tests/e2e/bdd/fixtures/window-state.fixture.ts'],
  outputDir: '.features-gen/window-state'
})

const userPreferencesTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/user_preferences/features/**/*.feature',
  steps: ['tests/e2e/bdd/user_preferences/steps/**/*.ts', 'tests/e2e/bdd/fixtures/user-preferences.fixture.ts'],
  outputDir: '.features-gen/user_preferences'
})

const monacoTypingTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/monaco-typing/features/**/*.feature',
  steps: ['tests/e2e/bdd/monaco-typing/steps/**/*.ts', 'tests/e2e/bdd/fixtures/handlebars.fixture.ts'],
  outputDir: '.features-gen/monaco-typing'
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
      name: 'handlebars',
      testDir: handlebarsTestDir
    },
    {
      name: 'search',
      testDir: searchTestDir
    },
    {
      name: 'open-folder',
      testDir: openFolderTestDir
    },
    {
      name: 'dirty-state',
      testDir: dirtyStateTestDir
    },
    {
      name: 'save-operations',
      testDir: saveOperationsTestDir
    },
    {
      name: 'import',
      testDir: importTestDir
    },
    {
      name: 'sidebar-sync',
      testDir: sidebarSyncTestDir
    },
    {
      name: 'icon-change',
      testDir: iconChangeTestDir
    },
    {
      name: 'navigation',
      testDir: navigationTestDir
    },
    {
      name: 'window-state',
      testDir: windowStateTestDir
    },
    {
      name: 'user_preferences',
      testDir: userPreferencesTestDir
    },
    {
      name: 'monaco-typing',
      testDir: monacoTypingTestDir
    },
  ]
})
