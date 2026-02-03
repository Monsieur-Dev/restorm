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

const toggleTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/toggle/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/toggle/steps/**/*.ts',
    'tests/e2e/bdd/toggle/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/toggle'
})

const radioTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/radio/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/radio/steps/**/*.ts',
    'tests/e2e/bdd/radio/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/radio'
})

const progressBarTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/progressbar/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/progressbar/steps/**/*.ts',
    'tests/e2e/bdd/progressbar/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/progressbar'
})

const sashTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/sash/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/sash/steps/**/*.ts',
    'tests/e2e/bdd/sash/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/sash'
})

const markdownViewerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/markdownviewer/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/markdownviewer/steps/**/*.ts',
    'tests/e2e/bdd/markdownviewer/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/markdownviewer'
})

const markdownEditorTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/markdowneditor/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/markdowneditor/steps/**/*.ts',
    'tests/e2e/bdd/markdowneditor/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/markdowneditor'
})

const workbenchTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/workbench/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/workbench/steps/**/*.ts',
    'tests/e2e/bdd/workbench/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/workbench'
})

const menubarTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/menubar/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/menubar/steps/**/*.ts',
    'tests/e2e/bdd/menubar/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/menubar'
})

const statusbarTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/statusbar/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/statusbar/steps/**/*.ts',
    'tests/e2e/bdd/statusbar/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/statusbar'
})

const tagsViewTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/tagsview/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/tagsview/steps/**/*.ts',
    'tests/e2e/bdd/tagsview/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/tagsview'
})

const dateTimePickerTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/datetimepicker/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/datetimepicker/steps/**/*.ts',
    'tests/e2e/bdd/datetimepicker/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/datetimepicker'
})

const iconSelectTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/iconselect/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/iconselect/steps/**/*.ts',
    'tests/e2e/bdd/iconselect/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/iconselect'
})

const selectBoxTestDir = defineBddConfig({
  features: 'tests/e2e/bdd/selectbox/features/**/*.feature',
  steps: [
    'tests/e2e/bdd/selectbox/steps/**/*.ts',
    'tests/e2e/bdd/selectbox/fixtures/**/*.ts'
  ],
  outputDir: '.features-gen/selectbox'
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
    },
    {
      name: 'toggle',
      testDir: toggleTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'radio',
      testDir: radioTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'progressbar',
      testDir: progressBarTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'sash',
      testDir: sashTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'markdownviewer',
      testDir: markdownViewerTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'markdowneditor',
      testDir: markdownEditorTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'workbench',
      testDir: workbenchTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'menubar',
      testDir: menubarTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'statusbar',
      testDir: statusbarTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'tagsview',
      testDir: tagsViewTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'datetimepicker',
      testDir: dateTimePickerTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'iconselect',
      testDir: iconSelectTestDir,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'selectbox',
      testDir: selectBoxTestDir,
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
