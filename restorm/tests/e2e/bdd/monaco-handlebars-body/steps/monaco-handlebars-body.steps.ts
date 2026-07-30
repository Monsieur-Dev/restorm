/**
 * Steps for the `monaco-handlebars-body` BDD suite. Drives restorm through the
 * shared MCP fixture (`launchAppWithMcp` + `callMcpTool`): open a working copy of
 * the HTTP sample, `create_request` + `update_request` one request per body under
 * test, then `open_tab` each and read Monaco's error decorations off the visible
 * body editor.
 *
 * `.squiggly-error` is the class Monaco puts on an Error-severity marker's
 * decoration, so counting it is the closest a test can get to "what the user sees
 * as a red underline" without reaching into the editor's model. The colouring is
 * read the same way — off `.ecui-handlebars-construct`, the class the editor's
 * own decoration stamps on a construct — and compared against the colour the
 * active theme resolves for a variable, so the assertion is about the rendered
 * pixels rather than about the code that asked for them.
 *
 * Inactive request tabs stay MOUNTED (the tab slot only toggles `display:none`),
 * so every opened request keeps a body editor in the DOM: everything here is
 * scoped to the `:visible` one, and each assertion first waits for that editor to
 * show its own `case` marker so a stale tab can never answer for the new one.
 *
 * No request is ever sent, so this suite needs no Docker mock.
 */

import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import { copyFileSync, mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null
let requestsByName = new Map<string, string>()
/** Folder the sample's own requests live in — where the fixtures are created. */
let sampleFolderId: string | null = null

const BODY_EDITOR = '[data-testid="http-request-body-editor"]:visible'
const ERROR_MARKER = `${BODY_EDITOR} .squiggly-error`
/** The inline class the editor's Handlebars colouring stamps on a construct. */
const HANDLEBARS_SPAN = `${BODY_EDITOR} .ecui-handlebars-construct`
/**
 * How long the JSON worker gets to publish its verdict before "no error marker"
 * is believed. The worker validates asynchronously, so an immediately-empty
 * decoration set would otherwise just mean "not validated yet".
 */
const VALIDATION_SETTLE_MS = 2_500

function requirePage(): Page {
  if (!page) throw new Error('open the project first')
  return page
}

function requireDiscovery(): McpDiscovery {
  if (discovery === null) throw new Error('launch first')
  return discovery
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
  sampleFolderId = null
})

Given('I open the HTTP sample via MCP', async ({ callMcpTool, restormRoot }) => {
  const disco = requireDiscovery()
  // Open a COPY: the fixtures below create requests and the renderer autosaves,
  // so pointing the app at the repo file would dirty the checkout every run.
  const samplePath = join(restormRoot, 'tests/e2e/samples/http-sample.restorm')
  const tmpDir = join(restormRoot, 'tests/e2e/.tmp')
  mkdirSync(tmpDir, { recursive: true })
  const workingCopy = join(tmpDir, 'monaco-handlebars-body.working.restorm')
  copyFileSync(samplePath, workingCopy)

  const opened = await callMcpTool(disco, 'open_project', { filePath: workingCopy })
  expect(opened.isError ?? false).toBe(false)

  const deadline = Date.now() + 20_000
  let requests: { id: string; name: string; parentId: string | null }[] = []
  while (Date.now() < deadline) {
    requests = parsedReply(await callMcpTool(disco, 'list_requests', {})) as typeof requests
    if (requests.some((request) => request.name === 'POST echo')) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const anchor = requests.find((request) => request.name === 'POST echo')
  expect(anchor, 'sample requests not loaded').toBeTruthy()
  sampleFolderId = anchor?.parentId ?? null
  expect(sampleFolderId, 'the sample requests have no parent folder').toBeTruthy()
})

Given('a request {string} whose text body is:', async ({ callMcpTool }, name: string, body: string) => {
  const disco = requireDiscovery()
  if (sampleFolderId === null) throw new Error('open the project first')
  const created = parsedReply(await callMcpTool(disco, 'create_request', {
    parentFolderId: sampleFolderId,
    name,
    protocol: 'http'
  })) as { id?: string }
  expect(created.id, `create_request failed for "${name}"`).toBeTruthy()
  const id = created.id ?? ''
  const patched = await callMcpTool(disco, 'update_request', {
    id,
    patch: { method: 'POST', body: { type: 'text', content: body } }
  })
  expect(patched.isError ?? false, `update_request failed for "${name}"`).toBe(false)
  requestsByName.set(name, id)
})

When('I open the {string} request tab via MCP', async ({ callMcpTool }, name: string) => {
  const disco = requireDiscovery()
  const id = requestsByName.get(name)
  expect(id, `request "${name}" was never created`).toBeTruthy()
  const opened = await callMcpTool(disco, 'open_tab', { itemId: id ?? '' })
  expect(opened.isError ?? false).toBe(false)
  await requirePage().locator(BODY_EDITOR).first().waitFor({ state: 'visible', timeout: 20_000 })
})

/** Wait until the visible body editor renders the document tagged `marker`. */
async function waitForBody(marker: string): Promise<void> {
  await expect(requirePage().locator(BODY_EDITOR).first()).toContainText(marker, { timeout: 20_000 })
}

Then(
  'the request body editor shows {string} and reports at least one error marker',
  async ({}, marker: string) => {
    await waitForBody(marker)
    const markers = requirePage().locator(ERROR_MARKER)
    await expect.poll(async () => markers.count(), { timeout: 20_000 }).toBeGreaterThan(0)
  }
)

Then(
  'the request body editor shows {string} and reports no error marker',
  async ({}, marker: string) => {
    await waitForBody(marker)
    const p = requirePage()
    // Give the worker its window, then require the decoration set to STILL be
    // empty — the previous case proved a broken document does light one up.
    await p.waitForTimeout(VALIDATION_SETTLE_MS)
    await expect(p.locator(ERROR_MARKER)).toHaveCount(0)
  }
)

Then(
  'the request body editor colours {string} with the theme variable colour',
  async ({}, construct: string) => {
    const p = requirePage()
    const spans = p.locator(HANDLEBARS_SPAN)
    await expect.poll(async () => spans.count(), { timeout: 20_000 }).toBeGreaterThan(0)
    // The colouring must cover the construct and nothing else — the quotes it
    // sits between belong to the payload and keep the string colour. Joined
    // rather than compared element-wise: Monaco splits a rendered line into
    // spans on its own terms, and how many it uses here is not the contract.
    expect((await spans.allInnerTexts()).join('')).toBe(construct)

    // Resolve `--hljs-variable` the way the browser does, so the comparison is
    // against a real rgb() triple rather than the raw hex in the theme file.
    const { raw, colour: expected } = await p.evaluate(() => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue('--hljs-variable')
        .trim()
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.appendChild(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return { raw: value, colour: resolved }
    })
    // An undefined variable would resolve the probe to the inherited colour, and
    // the assertion below would then be comparing against something arbitrary.
    expect(raw, '--hljs-variable is not defined for the active theme').not.toBe('')
    await expect
      .poll(
        async () =>
          spans.evaluateAll((nodes) => [
            ...new Set(nodes.map((node) => getComputedStyle(node).color))
          ]),
        { timeout: 10_000 }
      )
      .toEqual([expected])
  }
)
