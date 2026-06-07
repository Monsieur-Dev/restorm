import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, SCENARIO_SUGGESTIONS_TEMP_DIR } from '../../fixtures/scenario-suggestions.fixture'

const SAMPLES_DIR = resolve(__dirname, '../../../samples')
const REFERENCE_SAMPLE = join(SAMPLES_DIR, 'scenarios-e2e-reference-tests.restorm')
// Stable committed reference (`-history`); the runtime `.responses.zip` is
// gitignored (rewritten per run). Copied into the temp working dir so the
// samples tree never churns.
const REFERENCE_RESPONSES = join(SAMPLES_DIR, 'scenarios-e2e-reference-tests.restorm.responses-history.zip')

/** One golden per scenario, next to the sample (committed + inspectable), NOT
 * under .features-gen (gitignored). Regenerate after an intentional change with
 * UPDATE_SUGGESTIONS_GOLDEN=1. */
function goldenPathFor(scenarioName: string): string {
  const slug = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return join(SAMPLES_DIR, `scenarios-e2e-reference-tests.${slug}-suggestions.json`)
}

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let extracted: unknown = null
let extractedFor = ''

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}
function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}
function sidebarRowByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
}

/** A `log` / `now` action stamps the current instant, which would make the
 * snapshot flaky. Replace those time fields with a placeholder; config-embedded
 * dates (different keys) are left intact so real value regressions still show. */
function normalizeDynamic(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeDynamic)
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = k === 'timestamp' || k === 'now' ? '<dynamic-time>' : normalizeDynamic(val)
    }
    return out
  }
  return v
}

Given('I open the scenarios reference-tests sample', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  // Copy the project AND its call-history zip side by side: the history backs
  // REST-request suggestions (harmless for the all-static log scenario).
  const workingCopy = join(SCENARIO_SUGGESTIONS_TEMP_DIR, 'scenarios-e2e-reference-tests.restorm')
  copyFileSync(REFERENCE_SAMPLE, workingCopy)
  copyFileSync(REFERENCE_RESPONSES, `${workingCopy}.responses.zip`)

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(requirePage(), 'Auth Service')).toBeVisible({ timeout: 15000 })
})

When('I extract the inspector suggestions for the scenario {string}', async ({}, scenarioName: string) => {
  const p = requirePage()
  // The extractor registers on the window at app mount — wait for it.
  await p.waitForFunction(
    () => typeof (window as { __restormSuggestions?: { extract?: unknown } }).__restormSuggestions?.extract === 'function',
    null,
    { timeout: 10000 }
  )
  const result = await p.evaluate(async (name) => {
    const bridge = (window as unknown as { __restormSuggestions: { extract: (n: string) => Promise<unknown> } }).__restormSuggestions
    return bridge.extract(name)
  }, scenarioName)
  if (result === null) throw new Error(`scenario "${scenarioName}" not found in the loaded project`)
  extracted = normalizeDynamic(result)
  extractedFor = scenarioName
})

Then('the extracted suggestions match the snapshot', async () => {
  expect(extracted).not.toBeNull()
  const golden = goldenPathFor(extractedFor)
  const actual = `${JSON.stringify(extracted, null, 2)}\n`
  if (process.env.UPDATE_SUGGESTIONS_GOLDEN === '1') {
    writeFileSync(golden, actual, 'utf-8')
  } else if (!existsSync(golden)) {
    // Don't silently self-bless a missing golden — a renamed slug must fail, not
    // create a fresh golden. Creating one is always an explicit UPDATE action.
    throw new Error(`suggestions golden missing: ${golden} — create it with UPDATE_SUGGESTIONS_GOLDEN=1`)
  }
  expect(actual, `suggestions drifted from ${golden} — regenerate with UPDATE_SUGGESTIONS_GOLDEN=1 if intended`).toBe(
    readFileSync(golden, 'utf-8')
  )
})
