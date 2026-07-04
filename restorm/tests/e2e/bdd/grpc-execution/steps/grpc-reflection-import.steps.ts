/**
 * Steps for the `grpc-reflection-import` scenario — imports a live server's
 * services via `grpc.reflection.v1alpha.ServerReflection` (no `.proto` file)
 * against the real grpcbin container, then runs a discovered method through
 * the normal gRPC client tab. Shares the `mcp-server` fixture + launch step
 * with `grpc-execution.steps.ts` (same BDD project — see `playwright.config.ts`).
 */

import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { test, expect, type McpDiscovery } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let page: Page | null = null

const INVOKE_BTN = '[data-testid="grpc-send-button"]:visible'
const RESPONSE_STATUS = '[data-testid="grpc-response-status"]'

function requirePage(): Page {
  if (page === null) throw new Error('launch first')
  return page
}

function sidebarRow(p: Page, name: string): ReturnType<Page['locator']> {
  return p.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) }).first()
}

/** Expand a sidebar folder row so its children render in the DOM — a
 * freshly imported folder starts collapsed. Idempotent. */
async function expandFolder(p: Page, name: string): Promise<void> {
  const row = sidebarRow(p, name)
  await expect(row).toBeVisible({ timeout: 15000 })
  if ((await row.getAttribute('aria-expanded')) === 'true') return
  const expander = row.locator('button.list-view-expander').first()
  await expander.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
}

// Distinct wording from `grpc-execution.steps.ts`'s "I launch restorm with
// the MCP server enabled" — both files register steps into the SAME BDD
// project (see `playwright.config.ts`'s `grpc-execution` testDir), and an
// identical step text in two files is an ambiguous-step-definition error at
// bddgen time, not a shared handler. Each file keeps its own module-scope
// `discovery` / `page`.
Given('I launch a dedicated restorm MCP instance for gRPC reflection import', async ({ launchAppWithMcp }) => {
  const launched = await launchAppWithMcp()
  discovery = launched.discovery
  page = launched.page
})

Given('I open a fresh project via MCP', async ({ callMcpTool }) => {
  if (discovery === null) throw new Error('launch first')
  const disco = discovery
  const filePath = `/tmp/grpc-reflection-import-e2e-${String(Date.now())}.restorm`
  expect((await callMcpTool(disco, 'create_project', { filePath })).isError ?? false).toBe(false)

  // `create_project` opens the empty project ASYNCHRONOUSLY in the renderer;
  // a UI action fired too early can race the still-in-flight load, which
  // later flushes the renderer's (still-empty) tree back and would wipe an
  // import that landed in the gap. Poll `list_folders` for a stable read
  // (same count across consecutive polls) before touching the UI.
  const deadline = Date.now() + 15_000
  let consecutive = 0
  let lastCount = -1
  while (Date.now() < deadline && consecutive < 4) {
    const reply = await callMcpTool(disco, 'list_folders', {})
    const text = reply.content?.[0]?.text ?? '[]'
    const count = (JSON.parse(text) as unknown[]).length
    consecutive = count === lastCount ? consecutive + 1 : 1
    lastCount = count
    await new Promise((r) => setTimeout(r, 200))
  }
})

When('I open the Import dialog and switch to the gRPC reflection card', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 15000 })
  // The showcase rotates through ~17 formats every 15s — waiting out the
  // cycle to reach `grpc-reflection` would be minutes-slow and flaky.
  // Jump straight to it via the e2e-only hook (see `ImportFormatShowcase.tsx`).
  const jumped = await p.evaluate(() => {
    const w = window as unknown as { __e2eSetImportFormatShowcaseIndex?: (id: string) => boolean }
    return w.__e2eSetImportFormatShowcaseIndex?.('grpc-reflection') ?? false
  })
  expect(jumped, 'e2e showcase-jump hook not found — did ImportFormatShowcase mount?').toBe(true)
  await expect(p.locator('[data-testid="import-format-showcase-action-grpc-reflection"]').first())
    .toBeVisible({ timeout: 5000 })
})

When('I connect to {string} via gRPC reflection', async ({}, address: string) => {
  const p = requirePage()
  await p.locator('[data-testid="import-format-showcase-action-grpc-reflection"]').first().click()
  const reflectionModal = p.locator('[data-testid="grpc-reflection-import-modal"]')
  await expect(reflectionModal).toBeVisible({ timeout: 5000 })
  // ECUI's `InputBox` puts `data-testid` on the outer wrapper and forwards
  // `${dataTestId}-input` to the actual `<input>`/`<textarea>` element.
  await p.locator('[data-testid="grpc-reflection-address-input-input"]').fill(address)
  const importButton = p.locator('[data-testid="grpc-reflection-import-button"]')
  // ECUI's `Button` is a styled div, not a native `<button disabled>` — it
  // signals disabled state via `aria-disabled`, which `toBeEnabled()`
  // doesn't check.
  await expect(importButton).toHaveAttribute('aria-disabled', 'false', { timeout: 5000 })
  await importButton.click()
  await expect(reflectionModal).not.toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="import-modal-dialog"]')).not.toBeVisible({ timeout: 15000 })
})

Then('the sidebar should contain an environment folder named {string}', async ({}, name: string) => {
  const p = requirePage()
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 15000 })
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 15000 })
})

When('I open the imported {string} request and invoke it', async ({}, name: string) => {
  const p = requirePage()
  // Tree shape from a reflection import: env folder (generic "gRPC API" —
  // grpcbin's reflection surface spans several packages, so there's no
  // single package name to use) > service folder "grpcbin.GRPCBin" > one
  // request per RPC method (see `buildEnvironmentFolderFromParsedProto` in
  // `GrpcImportService.ts`).
  await expandFolder(p, 'gRPC API')
  await expandFolder(p, 'grpcbin.GRPCBin')
  await sidebarRow(p, name).dblclick()
  const invokeButton = p.locator(INVOKE_BTN).first()
  await expect(invokeButton).toBeVisible({ timeout: 15000 })
  await invokeButton.click()
})

Then('the gRPC response shows a non-error status', async () => {
  const p = requirePage()
  // `grpc-response-status` lives in the response panel's "Infos" tab, which
  // is NOT the default-selected tab once a response body also exists (see
  // `BaseRequestTabView.tsx`'s `responseTabs` — it defaults to `'response'`)
  // — select it explicitly before asserting, mirroring
  // `grpc-execution.steps.ts`'s `openInfosTab`.
  const infosTab = p.locator('[data-testid="base-request-tabs-response-tab-infos"]:visible').first()
  await infosTab.waitFor({ state: 'visible', timeout: 15000 })
  await infosTab.click()
  await p.locator('[data-testid="base-request-tabs-response-tabpanel-infos"]').first().waitFor({ state: 'visible', timeout: 10000 })
  await expect(p.locator(`${RESPONSE_STATUS}[data-status-code="0"]`).first()).toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="grpc-response-error"]')).toHaveCount(0)
})
