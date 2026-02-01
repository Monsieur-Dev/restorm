import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd'

const breadcrumbTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/breadcrumb/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/breadcrumb/steps/**/*.ts',
    'tests/e2e/bdd/breadcrumb/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/breadcrumb'
})

const buttonTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/button/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/button/steps/**/*.ts',
    'tests/e2e/bdd/button/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/button'
})

const calloutTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/callout/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/callout/steps/**/*.ts',
    'tests/e2e/bdd/callout/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/callout'
})

const colorPickerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/colorpicker/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/colorpicker/steps/**/*.ts',
    'tests/e2e/bdd/colorpicker/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/colorpicker'
})

const contextMenuTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/contextmenu/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/contextmenu/steps/**/*.ts',
    'tests/e2e/bdd/contextmenu/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/contextmenu'
})

const customWcoTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/customwco/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/customwco/steps/**/*.ts',
    'tests/e2e/bdd/customwco/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/customwco'
})

const codeEditorTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/codeeditor/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/codeeditor/steps/**/*.ts',
    'tests/e2e/bdd/codeeditor/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/codeeditor'
})

const inputBoxTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/inputbox/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/inputbox/steps/**/*.ts',
    'tests/e2e/bdd/inputbox/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/inputbox'
})

const variableInputBoxTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/variableinputbox/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/variableinputbox/steps/**/*.ts',
    'tests/e2e/bdd/variableinputbox/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/variableinputbox'
})

const keyValueTableTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/keyvaluetable/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/keyvaluetable/steps/**/*.ts',
    'tests/e2e/bdd/keyvaluetable/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/keyvaluetable'
})

const tooltipTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/tooltip/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/tooltip/steps/**/*.ts',
    'tests/e2e/bdd/tooltip/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/tooltip'
})

const scrollableElementTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/scrollableelement/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/scrollableelement/steps/**/*.ts',
    'tests/e2e/bdd/scrollableelement/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/scrollableelement'
})

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:5173',
    
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'breadcrumb',
      testDir: breadcrumbTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'button',
      testDir: buttonTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'callout',
      testDir: calloutTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'colorpicker',
      testDir: colorPickerTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'contextmenu',
      testDir: contextMenuTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'customwco',
      testDir: customWcoTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'codeeditor',
      testDir: codeEditorTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'inputbox',
      testDir: inputBoxTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'variableinputbox',
      testDir: variableInputBoxTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'keyvaluetable',
      testDir: keyValueTableTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'tooltip',
      testDir: tooltipTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'scrollableelement',
      testDir: scrollableElementTestDir,
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm dev:web',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
