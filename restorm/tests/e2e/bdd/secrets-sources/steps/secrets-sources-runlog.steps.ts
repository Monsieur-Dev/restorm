import { materializeSample } from '../../../helpers/testcontainers/services'
import { createBdd } from 'playwright-bdd'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, SECRETS_SOURCES_TEMP_DIR } from '../../fixtures/secrets-sources.fixture'
import { normalizeRunLogYaml } from '../../scenario-runlog/runLogShared'

const SAMPLES_DIR = resolve(__dirname, '../../../samples')
const SECRETS_SAMPLE = join(SAMPLES_DIR, 'secrets-sources-demo.restorm')

/** One golden per secret source, named after the source type (slugged). The
 * secrets fixture is a NON-shared sample, so its goldens may legitimately
 * carry the resolved secret plaintext (the run echoes it back) — same as the
 * auth-login run-log golden carries run-specific values. */
function secretGoldenPathFor(scenarioName: string): string {
  const slug = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return join(SAMPLES_DIR, `secrets-sources-demo.${slug}-runlog.yaml`)
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

/**
 * Run the scenario via the inspector Run button (no node selected → whole
 * scenario) and wait for completion. The secret scenarios raise no input
 * prompt (the secret resolves from process.env), so this driver just clicks
 * Run and waits for the copy button to mount while the Run button drops its
 * active class — the same filter-independent "logs are ready" signal the
 * scenario-runlog suite keys off.
 */
async function runScenario(p: Page): Promise<void> {
  await p.locator('[data-testid="scenario-inspector-run"]').click()
  const deadline = Date.now() + 60000
  for (;;) {
    const done = await p.evaluate(() => {
      const run = document.querySelector('[data-testid="scenario-inspector-run"]')
      const logsReady = document.querySelector('[data-testid="scenario-inspector-logs-copy"]')
      const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
      return !!logsReady && !running
    })
    if (done) return
    if (Date.now() > deadline) throw new Error('secret scenario did not finish within 60s')
    await p.waitForTimeout(150)
  }
}

Given('I open the secrets-sources demo collection for run-log capture', async ({ launchApp, services }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = join(SECRETS_SOURCES_TEMP_DIR, 'secrets-sources-demo.restorm')
  materializeSample(SECRETS_SAMPLE, workingCopy, services)

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(requirePage(), 'Secrets Service')).toBeVisible({ timeout: 15000 })
})

When('I run the secret scenario {string} and copy all its logs', async ({}, scenarioName: string) => {
  const p = requirePage()

  // The secret scenarios are direct children of the "Secrets Service"
  // collection; expand it, then open the scenario editor tab.
  await expandRowIfCollapsed(p, 'Secrets Service')
  await sidebarRowByName(p, scenarioName).click()
  await expect(p.locator('[data-testid="scenario-editor"]')).toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })

  await runScenario(p)

  // Show every entry (engine + run + user), then copy. The toggle defaults
  // off (user logs only); flip it on so the copy covers the full pipeline.
  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  // Click copy + read the clipboard back, retrying until it holds THIS
  // scenario's run boundary marker (the clipboard is system-wide and a stale
  // value from a previous run could otherwise false-pass).
  const ownMarker = `▶ ${scenarioName}`
  let text = ''
  await expect(async () => {
    await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()
    text = await requireApp().evaluate(({ clipboard }) => clipboard.readText())
    expect(text, `clipboard did not hold this run's log (missing "${ownMarker}")`).toContain(ownMarker)
  }).toPass({ timeout: 8000 })
  copiedYaml = normalizeRunLogYaml(text)
  copiedFor = scenarioName
})

Then('the secret-scenario run-log matches the snapshot', async () => {
  expect(copiedYaml.length).toBeGreaterThan(0)
  const golden = secretGoldenPathFor(copiedFor)
  if (process.env.UPDATE_RUNLOG_GOLDEN === '1') {
    writeFileSync(golden, copiedYaml, 'utf-8')
  } else if (!existsSync(golden)) {
    // Never silently self-bless a missing golden — creating one is always an
    // explicit UPDATE_RUNLOG_GOLDEN=1 action, mirroring the scenario-runlog suite.
    throw new Error(`run-log golden missing: ${golden} — create it with UPDATE_RUNLOG_GOLDEN=1`)
  }
  expect(copiedYaml, `run-log drifted from ${golden} — regenerate with UPDATE_RUNLOG_GOLDEN=1 if intended`).toBe(
    normalizeRunLogYaml(readFileSync(golden, 'utf-8'))
  )
})
