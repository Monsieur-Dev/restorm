/**
 * E2E: a scenario `setVariable` overrides an env-folder variable for a
 * downstream request (TASK-194 / folded into 66.26).
 *
 * The committed sample (scenario-setvariable-override.restorm — Yoann's Swagger
 * Petstore) declares `petId` in its env folder; the "Find pet by ID" request
 * uses `{{baseUrl}}/pet/{{petId}}`. The "setVariable override" scenario sets
 * petId=1 BEFORE the request, so the run must resolve to /pet/1 (the setVariable
 * value) and return "Cat 1" — proving the scenario variable wins over the env
 * folder's petId=3. Runs live against the petstore mock the e2e global-setup
 * hosts on localhost:8080, so the run-log is deterministic.
 */

import { createBdd } from 'playwright-bdd'
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect } from '../../fixtures/scenario-runlog.fixture'
import { normalizeRunLogYaml } from '../../scenario-runlog/runLogShared'

const SAMPLE = resolve(__dirname, '../../../samples/scenario-setvariable-override.restorm')
const GOLDEN = resolve(__dirname, '../../../samples/scenario-setvariable-override-runlog.yaml')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let copiedYaml = ''
/** Full log text copied out of the root-placed scenario's run. */
let rootRunLog = ''
/**
 * Renderer-side failures seen since the root scenario was created. The
 * missing-scenario failure arrives as an uncaught rejection from the
 * `scenario:engine:start` IPC call, so it never reaches a DOM assertion —
 * without capturing it, a broken run would leave every selector-based
 * expectation green.
 */
let rootRunFailures: string[] = []

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}
function sidebarRowByName(p: Page, name: string): Locator {
  return p.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) }).first()
}
async function expandRowIfCollapsed(p: Page, name: string): Promise<void> {
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 15000 })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
}

Given('I open the setVariable-override sample', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const dir = join(tmpdir(), `setvar-e2e-${String(process.pid)}`)
  mkdirSync(dir, { recursive: true })
  const workingCopy = join(dir, 'scenario-setvariable-override.restorm')
  copyFileSync(SAMPLE, workingCopy)

  await configureNextOpenDialogForE2E(launched.app, { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()
  await expect(sidebarRowByName(requirePage(), 'Swagger Petstore')).toBeVisible({ timeout: 15000 })
})

When('I run the {string} scenario and copy all its logs', async ({}, scenarioName: string) => {
  const p = requirePage()

  // Navigate Swagger Petstore > pet > <scenario> and open its editor tab.
  await expandRowIfCollapsed(p, 'Swagger Petstore')
  await expandRowIfCollapsed(p, 'pet')
  await sidebarRowByName(p, scenarioName).click()
  await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })

  // Run the whole scenario (no node selected). It has no input prompts, so it
  // falls straight through; completion = a copy button is present AND the Run
  // button has left its active state.
  await p.locator('[data-testid="scenario-inspector-run"]').click()
  await expect(async () => {
    const ready = await p.evaluate(() => {
      const run = document.querySelector('[data-testid="scenario-inspector-run"]')
      const logsReady = document.querySelector('[data-testid="scenario-inspector-logs-copy"]')
      const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
      return !!logsReady && !running
    })
    expect(ready, 'scenario did not finish').toBe(true)
  }).toPass({ timeout: 30000 })

  // Show every entry (engine + run + user), then copy + read the clipboard back,
  // retrying until it holds THIS run's COMPLETED log (start ▶ + end ■ markers).
  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  const startMarker = `▶ ${scenarioName}`
  const endMarker = `■ ${scenarioName}`
  let text = ''
  await expect(async () => {
    await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()
    if (!electronApp) throw new Error('app not launched')
    text = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(text, `clipboard missing start "${startMarker}"`).toContain(startMarker)
    expect(text, `run not complete (missing end "${endMarker}")`).toContain(endMarker)
  }).toPass({ timeout: 30000 })
  copiedYaml = normalizeRunLogYaml(text)
})

When('I create a scenario named {string} at the root of the sidebar', async ({}, name: string) => {
  const p = requirePage()
  rootRunFailures = []
  p.on('pageerror', (err) => rootRunFailures.push(err.message))
  p.on('console', (msg) => { if (msg.type() === 'error') rootRunFailures.push(msg.text()) })

  // Collapse the tree so there is empty area below it — the root context menu
  // only opens when the pointer is NOT over a row.
  await p.locator('[data-testid="sidebar-collapse-all-button"]').click()
  const area = p.locator('[data-testid="sidebar-empty-area"]')
  const box = await area.boundingBox()
  if (!box) throw new Error('sidebar empty area is not laid out')
  await area.click({
    button: 'right',
    position: { x: Math.round(box.width / 2), y: Math.round(box.height - 40) }
  })

  // "Ajouter" → "Scénario". The submenu entries are keyed by parent id and the
  // root uses the empty-string sentinel, hence the trailing dash.
  await p.locator('#add-root-child').hover()
  const scenarioEntry = p.locator('#add-scenario-')
  await expect(scenarioEntry).toBeVisible({ timeout: 10000 })
  await scenarioEntry.click()

  // The new row mounts in inline-rename mode.
  const nameInput = p.locator('[data-testid="sidebar-listview"] .list-view-row.is-selected input')
  await expect(nameInput).toBeVisible({ timeout: 10000 })
  await nameInput.fill(name)
  await nameInput.press('Enter')

  // Depth 0 is the load-bearing assertion: it proves the scenario is a SIBLING
  // of the collection rather than a child of it. Without it this step would
  // pass on a scenario created anywhere, and the whole point would be lost.
  const row = sidebarRowByName(p, name)
  await expect(row).toBeVisible({ timeout: 10000 })
  expect(await row.getAttribute('data-depth'), 'the new scenario must sit at the ROOT').toBe('0')
})

When('I run the root scenario {string} from its editor', async ({}, name: string) => {
  const p = requirePage()
  // Creating the item opens it in a workbench tab; click the row so we are
  // certainly driving THAT scenario's editor.
  await sidebarRowByName(p, name).click()
  await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })
  await p.locator('[data-testid="scenario-inspector-run"]').click()

  // "Show all logs" first: a scenario with no user-facing `log` action emits
  // only engine/run entries, and the copy button stays DISABLED until those are
  // in the filter — so toggling is what makes the run readable at all.
  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  const startMarker = `▶ ${name}`
  const endMarker = `■ ${name}`
  await expect(async () => {
    await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()
    if (!electronApp) throw new Error('app not launched')
    rootRunLog = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(rootRunLog, `clipboard missing start "${startMarker}"`).toContain(startMarker)
    expect(rootRunLog, `run not complete (missing end "${endMarker}")`).toContain(endMarker)
  }).toPass({ timeout: 30000 })
})

Then('the root scenario {string} ran without a missing-scenario error', async ({}, name: string) => {
  // The engine resolved the scenario and ran it to completion: these markers
  // are emitted by the run itself, so they cannot appear if `loadScenario`
  // threw. This is what makes the step prove a LAUNCH, not just a click.
  expect(rootRunLog, 'root scenario produced no run log').toContain(`▶ ${name}`)
  expect(rootRunLog, 'root scenario never completed').toContain(`■ ${name}`)
  // …and the failure this guards against never surfaced.
  const missing = rootRunFailures.filter((m) => /no scenario with id/i.test(m))
  expect(missing, `renderer reported a missing scenario: ${missing.join(' | ')}`).toEqual([])
})

Then('the setVariable run-log matches the snapshot', async () => {
  expect(copiedYaml.length).toBeGreaterThan(0)
  // Sanity: the overridden petId (1) is in the resolved URL, the env's (3) is not.
  expect(copiedYaml, 'resolved URL should use the setVariable petId (1)').toContain('/pet/1')
  expect(copiedYaml, 'resolved URL must NOT use the env-folder petId (3)').not.toContain('/pet/3')
  if (process.env.UPDATE_RUNLOG_GOLDEN === '1') {
    writeFileSync(GOLDEN, copiedYaml, 'utf-8')
  } else if (!existsSync(GOLDEN)) {
    throw new Error(`run-log golden missing: ${GOLDEN} — create it with UPDATE_RUNLOG_GOLDEN=1`)
  }
  expect(copiedYaml, `run-log drifted from ${GOLDEN} — regenerate with UPDATE_RUNLOG_GOLDEN=1 if intended`).toBe(
    readFileSync(GOLDEN, 'utf-8')
  )
})
