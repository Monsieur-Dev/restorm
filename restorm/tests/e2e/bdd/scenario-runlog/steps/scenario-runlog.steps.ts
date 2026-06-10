import { createBdd } from 'playwright-bdd'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, SCENARIO_RUNLOG_TEMP_DIR } from '../../fixtures/scenario-runlog.fixture'
import { goldenPathFor, normalizeRunLogYaml, setupReferenceWorkingCopy } from '../runLogShared'

/** Folders/containers to expand (in order) to reach the leaf scenarios in the
 * reference project's tree: Auth Service > Pet API > Main > <scenario>. */
const SCENARIO_TREE_PATH = ['Auth Service', 'Pet API', 'Main']

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

const INPUT_PROMPT = '[data-testid="scn-input-prompt"]'

/**
 * Fill ONE pending input field with a deterministic, NON-DEFAULT value chosen by
 * its value-type — so the run exercises real user-supplied inputs (not the
 * seeded defaults) while keeping the golden stable. `base` is the field's testid
 * prefix (`scn-input-prompt-<paramName>`); `type` is the `-value-type-<type>`
 * suffix the TypedValueField stamps, so this stays generic across any scenario's
 * inputs rather than hard-coding param names.
 */
async function fillScenarioInputField(p: Page, field: Locator, base: string, type: string): Promise<void> {
  switch (type) {
    case 'string':
      await field.locator(`[data-testid="${base}-value-input-string-input"]`).fill('e2e-value')
      return
    case 'numeric':
      await field.locator(`[data-testid="${base}-value-input-number-input"]`).fill('42')
      return
    case 'boolean':
      // Toggle once — the sample seeds `true`, so this lands on `false`.
      await field.locator(`[data-testid="${base}-value-input-boolean-action"]`).click()
      return
    case 'color': {
      // The hex InputBox is disabled by design — colour is set through the
      // picker popover. Open it via the swatch button, drive the Sketch picker's
      // HEX field (`.w-color-editable-input`, first input), then toggle it shut.
      const swatch = field.locator(`[data-testid="${base}-value-color-color-button"]`)
      await swatch.click()
      const hexInput = p.locator(`[data-testid="${base}-value-color-color-picker"] .w-color-editable-input input`).first()
      await hexInput.click()
      await hexInput.fill('abcdef')
      await hexInput.press('Enter')
      await swatch.click()
      return
    }
    case 'datetime':
      await field.locator(`[data-testid="${base}-value-datetime-picker"] input`).first().fill('2030-01-15 08:30:00')
      return
    case 'customlist':
      // ECUI SelectBox: the native <select> is decorative, so drive the custom
      // trigger + pick the first option (≠ the seeded default).
      await field.locator(`[data-testid="${base}-value-input-customlist-trigger"]`).click()
      await p.locator(`[data-testid="${base}-value-input-customlist-option-0"]`).click()
      return
    case 'customlistmulti': {
      // MultiSelectCombo: open, ADD the first not-yet-selected option (so the set
      // changes vs the default), then re-click the combo to close its dropdown —
      // an open dropdown would otherwise intercept the submit click.
      const combo = field.locator(`[data-testid="${base}-value-input-customlistmulti"]`)
      await combo.click()
      await p.locator(`[data-testid="${base}-value-input-customlistmulti-dropdown"] [role="option"][aria-selected="false"]`).first().click()
      await combo.click()
      return
    }
    case 'environment':
      // Pick the first environment in the picker (≠ the configured default).
      await field.locator(`[data-testid="${base}-value-input-environment"]`).click()
      await p.locator('[data-testid="tvf-env-selector-listview"] [data-testid^="tvf-env-selector-item-"]').first().click()
      return
    default:
      // Unknown/unhandled type: leave the seeded default — still answered on submit.
  }
}

/** Answer every field of the currently-open run-parameters prompt, then submit. */
async function answerScenarioInputPrompt(p: Page): Promise<void> {
  const prompt = p.locator(INPUT_PROMPT)
  const fields = prompt.locator('.scn-input-prompt-field')
  const count = await fields.count()
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i)
    const typeTestid = await field.locator('[data-testid*="-value-type-"]').first().getAttribute('data-testid')
    const m = typeTestid?.match(/^(.*)-value-type-([a-z]+)$/i)
    if (!m) continue
    await fillScenarioInputField(p, field, m[1], m[2].toLowerCase())
  }
  await prompt.locator('[data-testid="scn-input-prompt-submit"]').click()
}

/**
 * Run a scenario to completion, answering EVERY input prompt it raises along the
 * way — the up-front run-parameters modal AND any predecessor-wired input that
 * pends mid-run. A scenario with no inputs never shows a prompt and falls
 * straight through, so this single driver serves every scenario in the suite.
 *
 * Completion mirrors the engine's own signal: logs have been produced AND the
 * Run button has dropped its active class (engineState left 'running').
 */
async function runScenarioAnsweringPrompts(p: Page): Promise<void> {
  await p.locator('[data-testid="scenario-inspector-run"]').click()
  const deadline = Date.now() + 60000
  for (;;) {
    const done = await p.evaluate(() => {
      const run = document.querySelector('[data-testid="scenario-inspector-run"]')
      // The run-log section (toolbar + copy button) renders as soon as the run
      // has ANY log entry — independently of the "show all logs" toggle and the
      // level filters. The list row container, by contrast, only mounts when the
      // CURRENTLY-FILTERED set is non-empty; a scenario with no user `log` action
      // (e.g. pure compute nodes) shows the "no user logs" placeholder by default,
      // so keying completion off the list would hang forever on those. The copy
      // button is the filter-independent "logs are ready" signal.
      const logsReady = document.querySelector('[data-testid="scenario-inspector-logs-copy"]')
      const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
      return !!logsReady && !running
    })
    if (done) return
    if (await p.locator(INPUT_PROMPT).isVisible().catch(() => false)) {
      await answerScenarioInputPrompt(p)
    } else if (Date.now() > deadline) {
      throw new Error('scenario did not finish (or an input prompt was left unanswered) within 60s')
    } else {
      await p.waitForTimeout(150)
    }
  }
}

Given('I open the scenarios reference-tests sample', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  // Copy the project + its call-history zip + the readFile sidecar side by side.
  const workingCopy = setupReferenceWorkingCopy(SCENARIO_RUNLOG_TEMP_DIR)

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

  // Run via the inspector Run button (no node selected → whole scenario),
  // answering every input prompt the run raises with deterministic non-default
  // values. Prompt-free scenarios (Logs / Arithmetics / Loops) fall straight
  // through; Inputs/outputs raises an up-front modal + a mid-run input.
  await runScenarioAnsweringPrompts(p)

  // Show every entry (engine + run + user), then copy. The toggle defaults off
  // (user logs only); flip it on so the copy covers the full pipeline. The
  // interactive element is the ECUI Toggle's `-action` node (role=checkbox).
  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  // Click copy + read the clipboard back from Electron's main-process clipboard,
  // RETRYING until the clipboard holds THIS scenario's log. The OS clipboard is
  // system-wide and survives across the per-test Electron processes, so the
  // PREVIOUS scenario's copied log lingers there; a copy that grabs a not-yet-
  // rendered panel leaves that stale value in place. A bare non-empty guard then
  // false-passes on the neighbour's log and snapshots the wrong run. Every run
  // log opens with a `▶ <scenario>` boundary marker, so assert on that: it is
  // unique to this scenario among its neighbours and only appears once the panel
  // has actually re-rendered with this run's entries. Copy is idempotent.
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

Then('the copied run-log matches the snapshot', async () => {
  expect(copiedYaml.length).toBeGreaterThan(0)
  const golden = goldenPathFor(copiedFor)
  if (process.env.UPDATE_RUNLOG_GOLDEN === '1') {
    writeFileSync(golden, copiedYaml, 'utf-8')
  } else if (!existsSync(golden)) {
    // Don't silently self-bless a missing golden — that would let a renamed /
    // mistyped scenario slug pass green. Creating a golden is always an explicit
    // UPDATE_RUNLOG_GOLDEN=1 action.
    throw new Error(`run-log golden missing: ${golden} — create it with UPDATE_RUNLOG_GOLDEN=1`)
  }
  expect(copiedYaml, `run-log drifted from ${golden} — regenerate with UPDATE_RUNLOG_GOLDEN=1 if intended`).toBe(
    readFileSync(golden, 'utf-8')
  )
})
