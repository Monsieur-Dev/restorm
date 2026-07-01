import { createBdd } from 'playwright-bdd'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, SCENARIO_CODE_DEPS_TEMP_DIR } from '../../fixtures/scenario-code-deps.fixture'
import { goldenPathFor, normalizeRunLogYaml, setupReferenceWorkingCopy } from '../../scenario-runlog/runLogShared'

/** Tree path to the leaf scenarios in the reference project. */
const SCENARIO_TREE_PATH = ['Auth Service', 'Pet API', 'Main']

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
/** Run-log copied after the most recent run (raw copied YAML) + its scenario. */
let capturedLog = ''
let capturedFor = ''

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
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
}

/** Run the currently-open scenario to completion (no inputs → no prompts). */
async function runToCompletion(p: Page): Promise<void> {
  await p.locator('[data-testid="scenario-inspector-run"]').click()
  const deadline = Date.now() + 180000
  for (;;) {
    const done = await p.evaluate(() => {
      const run = document.querySelector('[data-testid="scenario-inspector-run"]')
      const logsReady = document.querySelector('[data-testid="scenario-inspector-logs-copy"]')
      const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
      return !!logsReady && !running
    })
    if (done) return
    if (Date.now() > deadline) throw new Error('code-deps scenario did not finish within 180s')
    await p.waitForTimeout(200)
  }
}

/**
 * Open the target scenario (first call navigates the tree; later calls no-op if
 * the tab is already open), run it, and capture the full run-log via the copy
 * button. The clipboard is cleared first so the captured text is unambiguously
 * THIS run's log (the OS clipboard survives across runs). The run-END marker
 * `■ <scenario>` gates the copy so a mid-run snapshot can't slip through.
 */
async function runScenarioAndCapture(scenarioName: string): Promise<void> {
  const p = requirePage()
  const editor = p.locator('[data-testid="scenario-editor"]')
  if (!(await editor.isVisible().catch(() => false))) {
    for (const folder of SCENARIO_TREE_PATH) await expandRowIfCollapsed(p, folder)
    await sidebarRowByName(p, scenarioName).click()
    await expect(editor).toBeVisible({ timeout: 15000 })
    await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })
  }

  // Empty the run-log panel BEFORE running so the captured log is unambiguously
  // THIS run's — otherwise a second run in the same session can be snapshotted
  // with the previous run's log (the copy button + prior entries linger until
  // the new run's async reset lands). Clear the OS clipboard for the same reason.
  const clearBtn = p.locator('[data-testid="scenario-inspector-logs-clear"]')
  if (await clearBtn.isEnabled().catch(() => false)) await clearBtn.click()
  await requireApp().evaluate(({ clipboard }) => { clipboard.clear() })

  await runToCompletion(p)

  // Show every entry (engine + user) so the capture covers the whole pipeline.
  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  // The panel was cleared, so the run-END marker `■ <scenario>` re-appears only
  // when THIS run completes — gating the copy on it can't grab a stale log.
  const endMarker = `■ ${scenarioName}`
  let text = ''
  await expect(async () => {
    const running = await p.evaluate(() => document.querySelector('[data-testid="scenario-inspector-run"]')?.classList.contains('scn-inspector-run-round-active') ?? false)
    expect(running, 'run still active').toBe(false)
    await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()
    text = await requireApp().evaluate(({ clipboard }) => clipboard.readText())
    expect(text, `run did not complete before copy (missing end "${endMarker}")`).toContain(endMarker)
  }).toPass({ timeout: 60000 })
  capturedLog = text
  capturedFor = scenarioName
}

Given('I open the reference sample with the offline package mirror', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = setupReferenceWorkingCopy(SCENARIO_CODE_DEPS_TEMP_DIR)
  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()
  await expect(sidebarRowByName(requirePage(), 'Auth Service')).toBeVisible({ timeout: 15000 })
})

When('I run the {string} scenario', async ({}, scenarioName: string) => {
  await runScenarioAndCapture(scenarioName)
})

When('I run the {string} scenario a second time', async ({}, scenarioName: string) => {
  await runScenarioAndCapture(scenarioName)
})

Then('the code-deps-chain run-log matches the golden', async () => {
  // Normalise (strip run-time noise) then compare to the committed golden — the
  // SAME pipeline the scenario-runlog goldens use. Regenerate on an intentional
  // chain change (or when a later language link is appended) with
  // UPDATE_RUNLOG_GOLDEN=1.
  const normalized = normalizeRunLogYaml(capturedLog)
  expect(normalized.length).toBeGreaterThan(0)
  const golden = goldenPathFor(capturedFor)
  if (process.env.UPDATE_RUNLOG_GOLDEN === '1') {
    writeFileSync(golden, normalized, 'utf-8')
  } else if (!existsSync(golden)) {
    throw new Error(`run-log golden missing: ${golden} — create it with UPDATE_RUNLOG_GOLDEN=1`)
  }
  expect(normalized, `run-log drifted from ${golden} — regenerate with UPDATE_RUNLOG_GOLDEN=1 if intended`).toBe(
    readFileSync(golden, 'utf-8')
  )
})

Then('the second run reports no package download', async () => {
  // The run-log resets each run, so the second (cache-hit) run's log must carry
  // NO downloading line — proof the package was served from the on-disk cache
  // populated by the first run, with no provisioning re-triggered.
  expect(capturedLog, 'second run should be a pure cache hit (no download)').not.toContain('Downloading')
})
