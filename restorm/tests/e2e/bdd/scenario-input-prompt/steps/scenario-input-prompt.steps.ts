/**
 * E2E: the run-parameters modal's answer is what the run dispatches.
 *
 * The committed sample (`scenario-input-prompt.restorm`) holds four request /
 * scenario pairs — one per marshalling family (raw scalar, coerced scalar,
 * enum-definition reference, value-list reference). Each pair is wired so the
 * three layers that could supply `petId` hold three DIFFERENT values:
 *
 *   input node's typed default = 1, request's own path param = 3, answer = 2
 *
 * so the assertion can name which layer won. The run must fetch pet 2 (`Cat 2`
 * on the docker petstore the e2e global-setup hosts on :8080) — the answer —
 * and must not fetch pet 1 or pet 3.
 */

import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect } from '../../fixtures/scenario-runlog.fixture'

const SAMPLE = resolve(__dirname, '../../../samples/scenario-input-prompt.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let copiedLog = ''

function requirePage(): Page {
  if (page === null) throw new Error('app must be launched before driving UI steps')
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

/**
 * Answer the modal's `petId` field, whichever editor the param's declared type
 * renders. The type is discovered from the DOM rather than passed in, so the
 * feature's Examples table stays a plain list of scenario names: a text-ish type
 * exposes an `<input>`, a reference-holding type a combobox whose option labels
 * are the enum values (`2`) or the value-list labels (`Pet 2`).
 */
async function answerPetId(p: Page, value: string): Promise<void> {
  const field = 'scn-input-prompt-petId-value'
  const text = p.locator(`[data-testid="${field}-input-string-input"], [data-testid="${field}-input-number-input"]`)
  if (await text.count() > 0) {
    await text.first().fill(value)
    // The ECUI InputBox debounces its onChange (300ms). Blur + assert the DOM
    // settled so Submit can't read the pre-debounce value.
    await text.first().blur()
    await expect(text.first()).toHaveValue(value)
    return
  }

  const enumTrigger = p.locator(`[data-testid="${field}-input-enum-trigger"]`)
  if (await enumTrigger.count() > 0) {
    await enumTrigger.click()
    await p.locator(`[data-testid^="${field}-input-enum-option-"]`)
      .filter({ hasText: new RegExp(`^${value}$`) }).first().click()
    await expect(enumTrigger).toHaveText(value)
    return
  }

  const listTrigger = p.locator(`[data-testid="${field}-input-customlist-trigger"]`)
  if (await listTrigger.count() > 0) {
    const label = `Pet ${value}`
    await listTrigger.click()
    await p.locator(`[data-testid^="${field}-input-customlist-option-"]`)
      .filter({ hasText: new RegExp(`^${label}$`) }).first().click()
    await expect(listTrigger).toHaveText(label)
    return
  }

  throw new Error(`no editor found for the petId prompt field (${field})`)
}

Given('I open the input-prompt sample', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const dir = join(tmpdir(), `input-prompt-e2e-${String(process.pid)}`)
  mkdirSync(dir, { recursive: true })
  const workingCopy = join(dir, 'scenario-input-prompt.restorm')
  copyFileSync(SAMPLE, workingCopy)

  await configureNextOpenDialogForE2E(launched.app, { kind: 'openFile', path: workingCopy })
  await requirePage().locator('[data-testid="titlebar-menubar-item-file"]').click()
  await requirePage().locator('[data-testid="titlebar-menu-item-open"]').first().click()
  await expect(sidebarRowByName(requirePage(), 'Input prompt petstore')).toBeVisible({ timeout: 15000 })
})

When('I run the {string} scenario and answer petId with {string}', async ({}, scenarioName: string, answer: string) => {
  const p = requirePage()

  await expandRowIfCollapsed(p, 'Input prompt petstore')
  await sidebarRowByName(p, scenarioName).click()
  await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })

  await p.locator('[data-testid="scenario-inspector-run"]').click()

  // The input node has no predecessor, so its param pends at run start and the
  // editor raises the run-parameters modal.
  await expect(p.locator('[data-testid="scn-input-prompt"]')).toBeVisible({ timeout: 15000 })
  await answerPetId(p, answer)
  await p.locator('[data-testid="scn-input-prompt-submit"]').click()
  await expect(p.locator('[data-testid="scn-input-prompt"]')).toHaveCount(0, { timeout: 15000 })

  // Completion = the logs are copyable AND the Run button has left its active
  // state (the same readiness pair the other scenario run-log specs use).
  await expect(async () => {
    const ready = await p.evaluate(() => {
      const run = document.querySelector('[data-testid="scenario-inspector-run"]')
      const logsReady = document.querySelector('[data-testid="scenario-inspector-logs-copy"]')
      const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
      return logsReady !== null && !running
    })
    expect(ready, 'scenario did not finish').toBe(true)
  }).toPass({ timeout: 30000 })

  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  const startMarker = `▶ ${scenarioName}`
  const endMarker = `■ ${scenarioName}`
  await expect(async () => {
    await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()
    if (electronApp === null) throw new Error('app not launched')
    copiedLog = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(copiedLog, `clipboard missing start "${startMarker}"`).toContain(startMarker)
    expect(copiedLog, `run not complete (missing end "${endMarker}")`).toContain(endMarker)
  }).toPass({ timeout: 30000 })
})

Then('the run fetched pet {int}, not the request\'s own {int} nor the input default {int}', async ({}, answered: number, requestOwn: number, inputDefault: number) => {
  expect(copiedLog.length).toBeGreaterThan(0)
  // The answered value reached the wire…
  expect(copiedLog, `resolved URL should use the answered petId (${String(answered)})`).toContain(`/pet/${String(answered)}`)
  expect(copiedLog, 'the response should be the answered pet').toContain(`Cat ${String(answered)}`)
  // …and neither of the two layers it has to beat did. Naming them separately is
  // what makes a failure diagnostic: pet 1 means the request's own path param won,
  // pet 2 means the input's default won.
  expect(copiedLog, `the request's own path param (${String(requestOwn)}) must not reach the URL`).not.toContain(`/pet/${String(requestOwn)}`)
  expect(copiedLog, `the input node's default (${String(inputDefault)}) must not reach the URL`).not.toContain(`/pet/${String(inputDefault)}`)
})
