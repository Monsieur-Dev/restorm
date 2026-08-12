import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

const TOAST_RELOAD = '[data-testid="file-external-change-reload"]'
const TOAST_KEEP_MINE = '[data-testid="file-external-change-keep-mine"]'

let page: Page | null = null
let discovery: McpDiscovery | null = null
let projectPath: string | null = null
let requestId: string | null = null

function parsedReply(reply: McpToolReply): unknown {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

async function callOk(
  callMcpTool: (d: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!discovery) throw new Error('launch the app first')
  const reply = await callMcpTool(discovery, name, args)
  expect(reply.isError ?? false, `${name} replied: ${JSON.stringify(reply)}`).toBe(false)
  return parsedReply(reply)
}

Given(
  'a saved project with one request is open',
  async ({ launchAppWithMcp, callMcpTool, mcpServerTempDir }) => {
    const launched = await launchAppWithMcp()
    page = launched.page
    discovery = launched.discovery
    projectPath = join(mcpServerTempDir, 'external-change.restorm')
    await callOk(callMcpTool, 'create_project', { filePath: projectPath })
    requestId = (await callOk(callMcpTool, 'create_request', { name: 'Original request', protocol: 'http' }) as { id: string }).id
    await callOk(callMcpTool, 'save_project', {})
    // The save is broadcast-triggered (autosave latch) — wait for the name
    // to land in the on-disk bytes before letting a step rewrite them.
    await expect(async () => {
      expect(readFileSync(projectPath ?? '', 'utf-8')).toContain('Original request')
    }).toPass({ timeout: 10_000 })
    // Let the save's own watcher echo settle (debounce + probe windows) so
    // a scenario's external rewrite is the only pending event.
    await page.waitForTimeout(800)
  }
)

When('the project file is rewritten on disk outside the app', async () => {
  if (!projectPath) throw new Error('open the project first')
  const bytes = readFileSync(projectPath, 'utf-8')
  writeFileSync(projectPath, bytes.replace('Original request', 'External request'), 'utf-8')
})

Then('the external-change toast shows up', async () => {
  if (!page) throw new Error('app not launched')
  await expect(page.locator(TOAST_RELOAD)).toBeVisible({ timeout: 10_000 })
})

When('the reload action is chosen', async () => {
  if (!page) throw new Error('app not launched')
  await page.locator(TOAST_RELOAD).click()
})

Then('the app reflects the disk version and the toast is gone', async ({ callMcpTool }) => {
  await expect(async () => {
    const listed = await callOk(callMcpTool, 'list_requests', {}) as { name: string }[]
    expect(listed.some((r) => r.name === 'External request'), 'the reloaded tree should hold the disk version').toBe(true)
  }).toPass({ timeout: 10_000 })
  await expect(page?.locator(TOAST_RELOAD) ?? (() => { throw new Error('no page') })()).toHaveCount(0)
})

When('the request is modified through the app and autosaved', async ({ callMcpTool }) => {
  if (!requestId) throw new Error('create the request first')
  await callOk(callMcpTool, 'update_request', { id: requestId, patch: { url: 'https://example.test/own-write' } })
  // MCP writes trigger the renderer autosave; give the write + watcher
  // echo + both probe windows time to run before asserting silence.
  await page?.waitForTimeout(2_000)
})

Then('no external-change toast shows up', async () => {
  if (!page) throw new Error('app not launched')
  await expect(page.locator(TOAST_RELOAD)).toHaveCount(0)
})

When('the keep-mine action is chosen', async () => {
  if (!page) throw new Error('app not launched')
  await page.locator(TOAST_KEEP_MINE).click()
})

Then('the disk file holds the in-memory version again', async () => {
  if (!projectPath) throw new Error('open the project first')
  await expect(async () => {
    const bytes = readFileSync(projectPath ?? '', 'utf-8')
    expect(bytes, 'keep-mine should overwrite the external rewrite').toContain('Original request')
    expect(bytes).not.toContain('External request')
  }).toPass({ timeout: 10_000 })
})

When('the secrets sidecar is written on disk outside the app', async () => {
  if (!projectPath || !page) throw new Error('open the project first')
  writeFileSync(`${projectPath}.env`, 'EnvF/Dev/TOKEN=externalvalue\n', 'utf-8')
  // The silent-reload path runs through the same debounce as the prompt
  // path — wait past it before asserting that NO toast appeared.
  await page.waitForTimeout(2_000)
})

// ───────────────────────────────────────────────────────────────────
// Env-variable reload lag (the resolved-URL preview must never be one
// reload behind: tabs re-register against the FRESH env context)
// ───────────────────────────────────────────────────────────────────

Given(
  'a saved project with an env variable used in a request URL is open',
  async ({ launchAppWithMcp, callMcpTool, mcpServerTempDir }) => {
    const launched = await launchAppWithMcp()
    page = launched.page
    discovery = launched.discovery
    projectPath = join(mcpServerTempDir, 'env-lag.restorm')
    // Paced writes: the main↔renderer mirror echoes each replace back and
    // a same-tick follow-up can be clobbered by the stale echo (see the
    // menubar-context steps for the same discipline).
    const paced = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const reply = await callOk(callMcpTool, name, args)
      await page?.waitForTimeout(500)
      return reply
    }
    await paced('create_project', { filePath: projectPath })
    const folderId = (await paced('create_folder', { name: 'EnvF', kind: 'env-folder' }) as { id: string }).id
    const envId = (await paced('create_environment', { envFolderId: folderId, name: 'Dev' }) as { id: string }).id
    await paced('set_env_variable', { envId, key: 'baseUrl', value: { type: 'string', value: 'valueone' } })
    requestId = (await paced('create_request', { name: 'Req', protocol: 'http', parentFolderId: folderId }) as { id: string }).id
    await paced('update_request', { id: requestId, patch: { url: '{{baseUrl}}/user/x' } })
    await expect(async () => {
      await callOk(callMcpTool, 'open_tab', { itemId: requestId })
    }).toPass({ timeout: 10_000 })
    await callOk(callMcpTool, 'save_project', {})
    await expect(async () => {
      expect(readFileSync(projectPath ?? '', 'utf-8')).toContain('valueone')
    }).toPass({ timeout: 10_000 })
    // Baseline: the preview resolves the initial value before any rewrite.
    await expect(async () => {
      expect(await page?.locator('[data-testid="url-resolved-preview"]').getAttribute('data-resolved-url')).toContain('valueone')
    }).toPass({ timeout: 10_000 })
    await page.waitForTimeout(800)
  }
)

When('the variable value is rewritten on disk outside the app', async () => {
  if (!projectPath) throw new Error('open the project first')
  const bytes = readFileSync(projectPath, 'utf-8')
  writeFileSync(projectPath, bytes.replace('valueone', 'valuetwo'), 'utf-8')
})

Then('the resolved URL preview shows the new value', async () => {
  if (!page) throw new Error('app not launched')
  await expect(async () => {
    const resolved = await page?.locator('[data-testid="url-resolved-preview"]').getAttribute('data-resolved-url')
    expect(resolved, 'the reloaded preview must resolve with the CURRENT disk value, not the previous one').toContain('valuetwo')
  }).toPass({ timeout: 10_000 })
})
