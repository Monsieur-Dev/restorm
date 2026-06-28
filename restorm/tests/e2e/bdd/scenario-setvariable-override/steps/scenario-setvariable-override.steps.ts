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
