import { createBdd } from 'playwright-bdd'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, SCENARIO_CODE_DEPS_REAL_TEMP_DIR } from '../../fixtures/scenario-code-deps-real.fixture'
import { setupReferenceWorkingCopy } from '../../scenario-runlog/runLogShared'

/** Tree path to the leaf scenarios in the reference project. */
const SCENARIO_TREE_PATH = ['Auth Service', 'Pet API', 'Main']

/** The per-language import-success markers the chain prints — proof each pinned
 * package installed from its live registry and mounted into its runtime. */
const LOADED_MARKERS = [
  'python: six loaded',
  'javascript: is-number loaded',
  'r: praise loaded',
  'ruby: paint loaded',
  'lua: inspect loaded'
]

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
/** Run-log captured after the most recent run (raw copied YAML text). */
let capturedLog = ''

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

/** Run the currently-open scenario to completion. A live install of five WASM
 * runtimes' packages is slow, so this budgets generously. */
async function runToCompletion(p: Page): Promise<void> {
  await p.locator('[data-testid="scenario-inspector-run"]').click()
  const deadline = Date.now() + 240000
  for (;;) {
    const done = await p.evaluate(() => {
      const run = document.querySelector('[data-testid="scenario-inspector-run"]')
      const logsReady = document.querySelector('[data-testid="scenario-inspector-logs-copy"]')
      const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
      return !!logsReady && !running
    })
    if (done) return
    if (Date.now() > deadline) throw new Error('code-deps-chain-real scenario did not finish within 240s')
    await p.waitForTimeout(200)
  }
}

/** Open the target scenario (first call navigates the tree), run it, and capture
 * the full run-log via the copy button — the run-END marker `■ <scenario>` gates
 * the copy so a mid-run snapshot can't slip through. Mirrors the offline lane's
 * capture, minus the golden comparison. */
async function runScenarioAndCapture(scenarioName: string): Promise<void> {
  const p = requirePage()
  const editor = p.locator('[data-testid="scenario-editor"]')
  if (!(await editor.isVisible().catch(() => false))) {
    for (const folder of SCENARIO_TREE_PATH) await expandRowIfCollapsed(p, folder)
    await sidebarRowByName(p, scenarioName).click()
    await expect(editor).toBeVisible({ timeout: 15000 })
    await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })
  }

  const clearBtn = p.locator('[data-testid="scenario-inspector-logs-clear"]')
  if (await clearBtn.isEnabled().catch(() => false)) await clearBtn.click()
  await requireApp().evaluate(({ clipboard }) => { clipboard.clear() })

  await runToCompletion(p)

  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  const endMarker = `■ ${scenarioName}`
  let text = ''
  await expect(async () => {
    const running = await p.evaluate(() => document.querySelector('[data-testid="scenario-inspector-run"]')?.classList.contains('scn-inspector-run-round-active') ?? false)
    expect(running, 'run still active').toBe(false)
    await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()
    text = await requireApp().evaluate(({ clipboard }) => clipboard.readText())
    expect(text, `run did not complete before copy (missing end "${endMarker}")`).toContain(endMarker)
  }).toPass({ timeout: 90000 })
  capturedLog = text
}

Given('I open the reference sample for a live dependency install', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = setupReferenceWorkingCopy(SCENARIO_CODE_DEPS_REAL_TEMP_DIR)
  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()
  await expect(sidebarRowByName(requirePage(), 'Auth Service')).toBeVisible({ timeout: 15000 })
})

When('I run the {string} scenario against live registries', async ({}, scenarioName: string) => {
  await runScenarioAndCapture(scenarioName)
})

When('I run the {string} scenario against live registries a second time', async ({}, scenarioName: string) => {
  await runScenarioAndCapture(scenarioName)
})

Then('every language reports its package loaded', () => {
  // Each runtime installed its pinned package from the live registry and mounted
  // it — the import-success marker proves the whole install→mount path per lang.
  for (const marker of LOADED_MARKERS) {
    expect(capturedLog, `missing live-install marker "${marker}"`).toContain(marker)
  }
})

Then('the first run reports a package download', () => {
  // A fresh (TMPDIR-isolated) cache means the first run must actually download —
  // the "Downloading" indicator proves the live-registry fetch happened rather
  // than a silent cache hit from a leaked prior run.
  expect(capturedLog, 'first run should download from the live registries').toContain('Downloading')
})

Then('the second run reports no package download', () => {
  // The run-log resets each run, so the second run's log carries NO downloading
  // line — proof the packages were served from the on-disk cache the first run
  // populated, with no provisioning re-triggered.
  expect(capturedLog, 'second run should be a pure cache hit (no download)').not.toContain('Downloading')
})
