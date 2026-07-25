/**
 * Steps for the `monaco-suggest-dismiss` BDD suite. Drives restorm through the
 * shared MCP fixture (`launchAppWithMcp` + `callMcpTool`): launch with the MCP
 * server, open the HTTP sample, `open_tab` a request by id, then type `{{` into
 * the URL field to open Monaco's variable-suggest popup.
 *
 * The suggest popup is reparented onto `document.body` (the field sets
 * `fixedOverflowWidgets` + `overflowWidgetsDomNode: document.body`), so
 * `.suggest-widget.visible` on the page is always a body-attached overlay —
 * exactly the element that used to linger over a different request after a tab
 * switch. The suite asserts it disappears when the tab is switched away, and
 * re-opens normally in the newly-active field (non-regression).
 *
 * No request is ever sent, so this suite needs no Docker mock.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import { copyFileSync, mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  variableInputBoxRootSelector,
  variableInputBoxSuggestWidgetSelector
} from 'electron-core-ui/testing'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()

const URL_INPUT = variableInputBoxRootSelector('http-request-url-input')
// Inactive request tabs stay MOUNTED (TabSlot toggles display:none, never
// unmounts — that persistence is exactly what this suite regression-tests), so
// several `http-request-url-input` editors coexist in the DOM at once: the
// active tab's is visible, the others are 0x0/hidden. A bare `.first()` can land
// on a hidden one, so scope the editor to the visible url-input.
const URL_EDITOR = `${URL_INPUT}:visible .monaco-editor`
const SUGGEST_WIDGET = variableInputBoxSuggestWidgetSelector

function requirePage(): Page {
  if (!page) throw new Error('open the project first')
  return page
}

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

Given('I launch restorm with the MCP server enabled', async ({ launchAppWithMcp }) => {
  const launched = await launchAppWithMcp()
  discovery = launched.discovery
  page = launched.page
  requestsByName = new Map()
})

Given('I open the HTTP sample via MCP', async ({ callMcpTool, restormRoot }) => {
  if (discovery === null) throw new Error('launch first')
  // Open a COPY of the sample: typing into the URL field mutates the request and
  // the renderer autosaves, so pointing the app at the repo file would dirty the
  // checkout on every run.
  const samplePath = join(restormRoot, 'tests/e2e/samples/http-sample.restorm')
  const tmpDir = join(restormRoot, 'tests/e2e/.tmp')
  mkdirSync(tmpDir, { recursive: true })
  const workingCopy = join(tmpDir, 'monaco-suggest-dismiss.working.restorm')
  copyFileSync(samplePath, workingCopy)

  const opened = await callMcpTool(discovery, 'open_project', { filePath: workingCopy })
  expect(opened.isError ?? false).toBe(false)

  const deadline = Date.now() + 20_000
  let reqs: { id: string; name: string }[] = []
  while (Date.now() < deadline) {
    const reply = await callMcpTool(discovery, 'list_requests', {})
    reqs = parsedReply(reply) as { id: string; name: string }[]
    if (reqs.some((r) => r.name === 'GET echo')) break
    await new Promise((r) => setTimeout(r, 250))
  }
  requestsByName = new Map(reqs.map((r) => [r.name, r.id]))
  expect(requestsByName.get('GET echo'), 'sample requests not loaded').toBeTruthy()
  expect(requestsByName.get('POST echo'), 'sample requests not loaded').toBeTruthy()
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  if (discovery === null || page === null) throw new Error('open the project first')
  const id = requestsByName.get(name)
  expect(id, `request "${name}" not found`).toBeTruthy()
  if (id === undefined) throw new Error(`request "${name}" missing`)
  const tab = await callMcpTool(discovery, 'open_tab', { itemId: id })
  expect(tab.isError ?? false).toBe(false)
  await page.locator(URL_EDITOR).first().waitFor({ state: 'visible', timeout: 20_000 })
})

When('I open the variable suggest dropdown in the URL field', async () => {
  const p = requirePage()
  const editor = p.locator(URL_EDITOR).first()
  await editor.click()
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  // Type the opening braces, then invoke suggest explicitly (quickSuggestions is
  // off for this field). The completion provider's items reach the field
  // asynchronously (env broadcast after the tab registers), and Monaco snapshots
  // them when the widget opens — so re-trigger the session on every retry rather
  // than only re-querying the DOM.
  await p.keyboard.type('{{')
  await expect(async () => {
    await p.keyboard.press('Escape')
    await p.keyboard.press('Control+Space')
    await expect(p.locator(SUGGEST_WIDGET).first()).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
})

Then('a Monaco suggest widget is visible on the page body', async () => {
  await expect(requirePage().locator(SUGGEST_WIDGET).first()).toBeVisible({ timeout: 5_000 })
})

Then('no Monaco suggest widget lingers on the page body', async () => {
  // The IntersectionObserver hide fires asynchronously after the previous tab's
  // slot flips to `display:none`; retry until the body-attached overlay is gone.
  await expect(requirePage().locator(SUGGEST_WIDGET)).toHaveCount(0, { timeout: 10_000 })
})
