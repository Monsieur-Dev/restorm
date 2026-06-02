import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, SCENARIO_RUNLOG_TEMP_DIR } from '../../fixtures/scenario-runlog.fixture'

const SAMPLES_DIR = resolve(__dirname, '../../../samples')
const REFERENCE_SAMPLE = join(SAMPLES_DIR, 'scenarios-e2e-reference-tests.restorm')
// The call-history zip the REST nodes back onto. The committed reference is the
// stable `-history` copy; the runtime `.responses.zip` is gitignored (the dev
// app + tests rewrite it per run). We copy this reference into the temp working
// dir, so the samples tree never churns.
const REFERENCE_RESPONSES = join(SAMPLES_DIR, 'scenarios-e2e-reference-tests.restorm.responses-history.zip')

/** Folders/containers to expand (in order) to reach the leaf scenarios in the
 * reference project's tree: Auth Service > Pet API > Main > <scenario>. */
const SCENARIO_TREE_PATH = ['Auth Service', 'Pet API', 'Main']

/** One golden per scenario, next to the sample (committed + inspectable), NOT
 * under .features-gen (gitignored). Regenerate after an intentional change with
 * UPDATE_RUNLOG_GOLDEN=1. */
function goldenPathFor(scenarioName: string): string {
  const slug = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return join(SAMPLES_DIR, `scenarios-e2e-reference-tests.${slug}-runlog.yaml`)
}

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let copiedYaml = ''
let copiedFor = ''

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
async function expandRowIfCollapsed(p: Page, name: string): Promise<void> {
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 15000 })
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded !== 'true') await row.click()
}

/** Data keys whose value is an absolute wall-clock instant stamped per run (a
 * `log` of the current time, or the engine's error context). Placeholdered so
 * the golden stays stable; config-embedded dates live under OTHER keys (e.g.
 * `BTTFArrivalDate`) and are left intact so real value regressions surface. */
const DYNAMIC_TIME_KEYS = new Set(['timestamp', 'now', 'startedAt', 'finishedAt', 'endedAt', 'completedAt'])

/** The copied message is `<emoji> [<date>] <text>`; the bracketed run-time would
 * make the golden flaky. Replace just that leading date bracket. */
function normalizeMessage(message: string): string {
  return message.replace(/^(\S+ )\[[^\]]*\]/, '$1[<time>]')
}
function normalizeData(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeData)
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = DYNAMIC_TIME_KEYS.has(k) ? '<dynamic-time>' : normalizeData(val)
    }
    return out
  }
  return v
}

/** Parse the copied YAML, strip run-time, re-emit canonical YAML. Both the live
 * copy and the golden go through this, so they compare deterministically. */
function normalizeRunLogYaml(raw: string): string {
  const entries = yamlParse(raw) as { message: string; data?: unknown }[]
  const normalized = entries.map((e) => {
    const message = normalizeMessage(e.message)
    return 'data' in e ? { message, data: normalizeData(e.data) } : { message }
  })
  return yamlStringify(normalized)
}

Given('I open the scenarios reference-tests sample', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  // Copy the project AND its call-history zip side by side (the REST nodes back
  // onto it; harmless for the pure log/arithmetic/loop scenarios under test).
  const workingCopy = join(SCENARIO_RUNLOG_TEMP_DIR, 'scenarios-e2e-reference-tests.restorm')
  copyFileSync(REFERENCE_SAMPLE, workingCopy)
  copyFileSync(REFERENCE_RESPONSES, `${workingCopy}.responses.zip`)

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(requirePage(), 'Auth Service')).toBeVisible({ timeout: 15000 })
})

When('I run the scenario {string} and copy all its logs', async ({}, scenarioName: string) => {
  const p = requirePage()

  // Navigate the tree to the leaf scenario, then open its editor tab.
  for (const folder of SCENARIO_TREE_PATH) await expandRowIfCollapsed(p, folder)
  await sidebarRowByName(p, scenarioName).click()
  await expect(p.locator('[data-testid="scenario-editor"]')).toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })

  // Run via the inspector Run button (no node selected → whole scenario).
  await p.locator('[data-testid="scenario-inspector-run"]').click()

  // Completion: logs have been produced AND the engine is no longer running
  // (the Run button drops its active class only when engineState leaves
  // 'running'). engineState is event-driven, decoupled from the visual beams.
  await p.waitForFunction(() => {
    const run = document.querySelector('[data-testid="scenario-inspector-run"]')
    const logList = document.querySelector('[data-testid="scenario-inspector-logs-list"]')
    const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
    return !!logList && !running
  }, null, { timeout: 30000 })

  // Show every entry (engine + run + user), then copy. The toggle defaults off
  // (user logs only); flip it on so the copy covers the full pipeline. The
  // interactive element is the ECUI Toggle's `-action` node (role=checkbox).
  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()
  await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()

  // The copy button writes the YAML to the clipboard via navigator.clipboard;
  // read it back from Electron's main-process clipboard module.
  const text = await requireApp().evaluate(({ clipboard }) => clipboard.readText())
  expect(text.trim().length, 'clipboard was empty after clicking copy').toBeGreaterThan(0)
  copiedYaml = normalizeRunLogYaml(text)
  copiedFor = scenarioName
})

Then('the copied run-log matches the snapshot', async () => {
  expect(copiedYaml.length).toBeGreaterThan(0)
  const golden = goldenPathFor(copiedFor)
  if (process.env.UPDATE_RUNLOG_GOLDEN === '1' || !existsSync(golden)) {
    writeFileSync(golden, copiedYaml, 'utf-8')
  }
  expect(copiedYaml, `run-log drifted from ${golden} — regenerate with UPDATE_RUNLOG_GOLDEN=1 if intended`).toBe(
    readFileSync(golden, 'utf-8')
  )
})
