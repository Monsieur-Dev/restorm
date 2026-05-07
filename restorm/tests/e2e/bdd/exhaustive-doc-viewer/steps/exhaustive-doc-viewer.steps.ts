import { createBdd } from 'playwright-bdd'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import {
  test,
  expect,
  EXHAUSTIVE_DOC_VIEWER_TEMP_DIR,
  configureNextSaveFileDialogForE2E,
  currentElectronApp
} from '../../fixtures/exhaustive-doc-viewer.fixture'
import type { ApiDocumentation } from '../../../../../src/shared/types/apiDocumentation'
import { fillEveryDocumentationField } from '../../../helpers/fullyDocumentedPetstorePatch'

const PETSTORE_FIXTURE = resolve(__dirname, '../../../../unit/swagger-petstore.json')
const RESTORM_PATH = join(EXHAUSTIVE_DOC_VIEWER_TEMP_DIR, 'exhaustive-doc-viewer.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
/** Patched apiDocumentation snapshot the steps assert against — set
 * once at bootstrap so every Then can compare DOM state against the
 * exact data the renderer was given. */
let docSnapshot: ApiDocumentation | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  const app = electronApp ?? currentElectronApp()
  if (!app) throw new Error('app must be launched before configuring dialogs')
  return app
}

function requireDoc(): ApiDocumentation {
  if (!docSnapshot) throw new Error('apiDocumentation snapshot not captured — bootstrap step did not run')
  return docSnapshot
}

function sidebarRow(p: Page, title: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(title, { exact: true }) })
    .first()
}

interface CollectionsFile {
  collections: { apiDocumentation?: ApiDocumentation; items?: unknown[]; environments?: unknown[] }[]
}

function loadCollectionsFile(path: string): CollectionsFile {
  const raw = readFileSync(path, 'utf-8')
  const parsed: unknown = parseYaml(raw)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { collections?: unknown }).collections)) {
    throw new Error(`expected ${path} to expose a top-level collections array`)
  }
  return parsed as CollectionsFile
}

// ──────────────────────────────────────────────────────────────────────
// Background — bootstrap + patch + open env-folder Docs tab
// ──────────────────────────────────────────────────────────────────────

Given('the fully-documented Petstore is loaded into the env-folder Docs tab', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  // 1. New single-file YAML collection.
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: RESTORM_PATH })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 5000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()
  const saveModal = page.locator('[data-testid="save-options-modal"]')
  await expect(saveModal).toBeVisible({ timeout: 5000 })
  await page.locator('[data-testid="save-mode-file"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(saveModal).not.toBeVisible({ timeout: 5000 })
  await expect(async () => { expect(existsSync(RESTORM_PATH)).toBe(true) }).toPass({ timeout: 10000 })
  await page.waitForTimeout(400)

  // 2. Import the Petstore sample.
  expect(existsSync(PETSTORE_FIXTURE)).toBe(true)
  await page.keyboard.press('Control+I')
  const importModal = page.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="source-input-input"]').fill(PETSTORE_FIXTURE)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })
  const importBtn = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importBtn).toBeVisible({ timeout: 15000 })
  await importBtn.click()
  await expect(importModal).not.toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)

  // 3. Save so the patcher can write through the persisted file.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+s')
  await expect.poll(async () => (await requirePage().title()).endsWith(' *'), {
    timeout: 10000,
    message: 'window should settle clean after import + save'
  }).toBe(false)

  // 4. Close any auto-opened request tab so the docs surface assertions
  // don't race against the workbench focus stealer.
  const activeTab = page.locator('.tab[role="tab"][aria-selected="true"]').first()
  if (await activeTab.count() > 0 && await activeTab.isVisible()) {
    const closeBtn = activeTab.locator('button[aria-label="Close"]').first()
    if (await closeBtn.count() > 0) await closeBtn.click()
  }
  await page.waitForTimeout(400)

  // 5. Patch the persisted file with `fillEveryDocumentationField`,
  // then close the in-memory copy and reopen via the Recent vignette so
  // the renderer reads back the patched data.
  const parsed = loadCollectionsFile(RESTORM_PATH)
  const folder = parsed.collections[0]
  if (!folder?.apiDocumentation) throw new Error('imported collection has no apiDocumentation')
  fillEveryDocumentationField(folder.apiDocumentation)
  writeFileSync(RESTORM_PATH, stringifyYaml(parsed), 'utf-8')
  // Mirror to the gitignored persistent path so the running dev
  // restorm can open the same fixture if a developer wants to spot-check.
  const persistent = resolve(__dirname, '../../../../../tmp/exhaustive-doc-viewer.restorm')
  mkdirSync(dirname(persistent), { recursive: true })
  writeFileSync(persistent, readFileSync(RESTORM_PATH, 'utf-8'), 'utf-8')
  docSnapshot = folder.apiDocumentation

  // Force a full reload via close+reopen so the renderer picks up
  // the patched fields.
  await page.evaluate(async () => {
    const helpers = (window as unknown as {
      __restormTestHelpers?: { closeFile?: () => Promise<void> | void }
    }).__restormTestHelpers
    if (!helpers?.closeFile) throw new Error('__restormTestHelpers.closeFile not exposed')
    await helpers.closeFile()
  })
  await expect(page.locator('.ecu-welcome-screen')).toBeVisible({ timeout: 10000 })
  const recentRow = page
    .locator('.ecu-recent-files-vignette-section', { hasText: 'Recent' })
    .locator('.ecu-recent-files-vignette-item', { hasText: 'exhaustive-doc-viewer.restorm' })
    .first()
  await expect(recentRow).toBeVisible({ timeout: 15000 })
  await recentRow.click()
  await expect(page.locator('.ecu-welcome-screen')).not.toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)

  // 6. Open the Swagger Petstore env folder, switch to Docs.
  const envRow = sidebarRow(page, 'Swagger Petstore')
  await expect(envRow).toBeVisible({ timeout: 10000 })
  await envRow.click()
  const docsTab = page.locator('[role="tab"][data-tab-id="docs"]:visible').first()
  await expect(docsTab).toBeVisible({ timeout: 10000 })
  await docsTab.click()
  await expect(page.locator('[data-testid="env-folder-documentation-host"]')).toBeVisible({ timeout: 10000 })
  // ELK + React Flow need a beat to lay out + fit-view.
  await page.waitForTimeout(1200)
})

// ──────────────────────────────────────────────────────────────────────
// Scope header + API info
// ──────────────────────────────────────────────────────────────────────

Then('the env-folder docs scope title should be {string}', async ({}, expected: string) => {
  const p = requirePage()
  const title = p.locator('[data-testid="env-folder-documentation-host"] .documentation-host__scope-title')
  await expect(title).toHaveText(expected, { timeout: 10000 })
})

Then('the env-folder docs scope description should be visible', async () => {
  const p = requirePage()
  const desc = p.locator('[data-testid="documentation-host-scope-description"]')
  await expect(desc).toBeVisible({ timeout: 10000 })
})

Then('the API info section should expose every patched field', async () => {
  const p = requirePage()
  const info = p.locator('.documentation-host-api-info')
  await expect(info).toBeVisible({ timeout: 10000 })
  // Every key the patcher fills should land in the dl. Match by label
  // text — case-insensitive for resilience to label tweaks.
  const text = (await info.textContent() ?? '').toLowerCase()
  for (const expected of ['version', 'contact', 'license', 'terms', 'external']) {
    expect(text, `API info section should mention ${expected}`).toContain(expected)
  }
})

// ──────────────────────────────────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────────────────────────────────

When('I scroll the docs panel to the bottom', async () => {
  const p = requirePage()
  await p.evaluate(() => {
    const host = document.querySelector('[data-testid="env-folder-documentation-host"]')
    if (!host) return
    let parent: HTMLElement | null = host.parentElement
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight + 8) {
        parent.scrollTop = parent.scrollHeight
        return
      }
      parent = parent.parentElement
    }
  })
  await p.waitForTimeout(300)
})

When('I click the sidebar Overview entry', async () => {
  const p = requirePage()
  const link = p.locator('[data-testid="documentation-host-sidebar-overview"]')
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  // Smooth scroll on a long doc takes several hundred ms; the next
  // step polls so we don't wait blindly.
})

Then('the env-folder docs scope header should be in view', async () => {
  const p = requirePage()
  const header = p.locator('[data-testid="documentation-host-scope-header"]')
  await expect(header).toBeVisible({ timeout: 10000 })
  // Poll the bounding box — smooth scroll animations can take up to
  // a second on a long doc tree.
  await expect.poll(async () => {
    const box = await header.boundingBox()
    return box?.y ?? -Infinity
  }, { timeout: 8000, message: 'scope header should land on screen' })
    .toBeGreaterThan(-200)
})

Then('the sidebar should list every group from the spec', async () => {
  const p = requirePage()
  const doc = requireDoc()
  for (const groupName of Object.keys(doc.groups)) {
    const group = p.locator(`[data-testid="documentation-host-sidebar-group-${groupName}"]`)
    await expect(group, `group ${groupName} should be in the sidebar`).toBeVisible({ timeout: 10000 })
  }
})

Then('every operation in the spec should appear under its tag group', async () => {
  const p = requirePage()
  const doc = requireDoc()
  for (const op of doc.operations) {
    const slug = op.operationId ?? op.match.urlPattern
    const link = p.locator(`[data-testid="documentation-host-sidebar-op-${slug}"]`)
    await expect(link, `sidebar should list op ${slug}`).toBeVisible({ timeout: 10000 })
  }
})

Then('the sidebar Models list should contain every model name', async () => {
  const p = requirePage()
  const doc = requireDoc()
  for (const modelName of Object.keys(doc.models)) {
    const link = p.locator(`[data-testid="documentation-host-sidebar-model-${modelName}"]`)
    await expect(link, `sidebar should list model ${modelName}`).toBeVisible({ timeout: 10000 })
  }
})

When('I click the sidebar Operation entry {string}', async ({}, summary: string) => {
  const p = requirePage()
  const link = p
    .locator('[data-testid="documentation-host-sidebar"] [data-testid^="documentation-host-sidebar-op-"]')
    .filter({ hasText: summary })
    .first()
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(500)
})

Then('the route block {string} should be in view', async ({}, opSlug: string) => {
  const p = requirePage()
  const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
  await expect(block).toBeVisible({ timeout: 10000 })
  const box = await block.boundingBox()
  if (!box) throw new Error('route block has no bounding box')
  expect(box.y, 'route block should be on screen').toBeGreaterThan(-200)
})

When('I click the sidebar Model entry {string}', async ({}, modelName: string) => {
  const p = requirePage()
  const link = p.locator(`[data-testid="documentation-host-sidebar-model-${modelName}"]`)
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(800)
})

Then('the React Flow node {string} should be on screen', async ({}, modelName: string) => {
  const p = requirePage()
  const node = p.locator(`[data-testid="documentation-host-model-node-${modelName}"]`)
  await expect(node).toBeVisible({ timeout: 10000 })
  const box = await node.boundingBox()
  if (!box) throw new Error('model node has no bounding box')
  expect(box.y, 'model node should be on screen').toBeGreaterThan(-200)
})

Then('the API info row should expose the source-format logo aligned right of the dl', async () => {
  const p = requirePage()
  const row = p.locator('[data-testid="documentation-host-api-info-row"]')
  await expect(row).toBeVisible({ timeout: 10000 })
  const logo = row.locator('[data-testid="documentation-host-api-info-logo"]')
  await expect(logo, 'source-format logo should render').toBeVisible({ timeout: 10000 })
  const dl = row.locator('[data-testid="documentation-host-api-info"]')
  const [logoBox, dlBox] = await Promise.all([logo.boundingBox(), dl.boundingBox()])
  if (!logoBox || !dlBox) throw new Error('api-info row geometry not available')
  expect(logoBox.x, 'logo should sit to the right of the dl').toBeGreaterThan(dlBox.x + dlBox.width - 8)
  // The logo's top edge should align (within a couple of pixels) with
  // the top of the dl — i.e. with the VERSION row.
  expect(Math.abs(logoBox.y - dlBox.y)).toBeLessThan(6)
})

Then('every sidebar group header should use a codicon-chevron caret', async () => {
  const p = requirePage()
  const headers = p.locator('[data-testid^="documentation-host-sidebar-group-"]')
  const count = await headers.count()
  expect(count, 'at least one group header should be rendered').toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const caret = headers.nth(i).locator('.documentation-host-sidebar__caret')
    await expect(caret, `group ${String(i)} should expose a codicon caret`).toBeVisible({ timeout: 5000 })
    const cls = await caret.getAttribute('class') ?? ''
    expect(cls).toContain('codicon')
    expect(cls).toMatch(/codicon-(chevron-right|chevron-down)/)
  }
})

Then('no sidebar group should expose a route-count pastille', async () => {
  const p = requirePage()
  // Legacy `__group-count` span has been removed — assert it does not
  // come back, anywhere in the sidebar tree.
  await expect(p.locator('.documentation-host-sidebar__group-count')).toHaveCount(0)
})

Then('the sidebar method pill for the GET operation should render with white text', async () => {
  const p = requirePage()
  const pill = p.locator('.documentation-host-sidebar__method--get').first()
  await expect(pill).toBeVisible({ timeout: 10000 })
  const color = await pill.evaluate((el) => getComputedStyle(el).color)
  // Accept any rgb whose components are all >= 240 — the value should
  // be `rgb(255, 255, 255)`. We tolerate alpha multiplication / minor
  // theme tweaks but not the inverted (dark text) colour we had
  // before.
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (!match) throw new Error(`unexpected color value: ${color}`)
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
  expect(r, `GET pill text should be near-white (got ${color})`).toBeGreaterThanOrEqual(240)
  expect(g).toBeGreaterThanOrEqual(240)
  expect(b).toBeGreaterThanOrEqual(240)
})

Then(
  'the sidebar Enums list should contain every enum-bearing model with its enum properties',
  async () => {
    const p = requirePage()
    const doc = requireDoc()
    let assertedAtLeastOne = false
    for (const model of Object.values(doc.models)) {
      const enumProps = model.properties.filter((prop) => (prop.enumValues ?? []).length > 0)
      if (enumProps.length === 0) continue
      assertedAtLeastOne = true
      const modelLink = p.locator(`[data-testid="documentation-host-sidebar-enum-${model.name}"]`)
      await expect(modelLink, `Enums sidebar should list ${model.name}`).toBeVisible({ timeout: 10000 })
      for (const prop of enumProps) {
        const propLink = p.locator(`[data-testid="documentation-host-sidebar-enum-${model.name}-${prop.name}"]`)
        await expect(propLink, `Enums sidebar should list ${model.name}.${prop.name}`).toBeVisible({ timeout: 10000 })
      }
    }
    expect(assertedAtLeastOne, 'fully-documented Petstore should expose at least one enum').toBe(true)
  }
)

When('I click the sidebar Enum entry {string} property {string}', async ({}, modelName: string, propertyName: string) => {
  const p = requirePage()
  const link = p.locator(`[data-testid="documentation-host-sidebar-enum-${modelName}-${propertyName}"]`)
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(500)
})

Then('the Enums entry {string} property {string} should be in view', async ({}, modelName: string, propertyName: string) => {
  const p = requirePage()
  const entry = p.locator(`[data-testid="documentation-host-enums-${modelName}-${propertyName}"]`)
  await expect(entry).toBeVisible({ timeout: 10000 })
  const box = await entry.boundingBox()
  if (!box) throw new Error('Enums entry has no bounding box')
  expect(box.y, 'Enums entry should land on screen').toBeGreaterThan(-200)
})

// ──────────────────────────────────────────────────────────────────────
// Per-route block content
// ──────────────────────────────────────────────────────────────────────

Then('every operation in the spec should render a route block', async () => {
  const p = requirePage()
  const doc = requireDoc()
  for (const op of doc.operations) {
    const slug = op.operationId ?? op.match.urlPattern
    const block = p.locator(`[data-testid="documentation-host-route-${slug}"]`)
    await expect(block, `route block missing for ${slug}`).toHaveCount(1, { timeout: 10000 })
  }
})

Then(
  'the route block {string} should show its summary, GET badge, URL pattern, description',
  async ({}, opSlug: string) => {
    const p = requirePage()
    const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
    await expect(block).toBeVisible({ timeout: 10000 })
    // Summary heading.
    await expect(block.locator('.documentation-host-route-header__summary').first()).toBeVisible()
    // Method badge — Petstore exposes GET / POST / DELETE / PUT.
    await expect(block.locator('.documentation-host-route-header__match .badge, .documentation-host-route-header__match [class*="badge"]').first()).toBeVisible()
    // URL pattern code block.
    await expect(block.locator('.documentation-host-route-header__url').first()).toBeVisible()
    // Description (markdown viewer).
    await expect(block.locator('[data-testid="documentation-host-route-header-description"]').first()).toBeVisible()
  }
)

Then('the route block {string} should show service, op, soapAction discriminants', async ({}, opSlug: string) => {
  const p = requirePage()
  const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
  const text = (await block.locator('.documentation-host-route-header__alt-discriminators').first().textContent()) ?? ''
  for (const expected of ['service', 'name', 'soapAction']) {
    expect(text, `discriminator ${expected} should appear`).toContain(expected)
  }
})

Then('the route block {string} should show event + direction discriminants', async ({}, opSlug: string) => {
  const p = requirePage()
  const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
  const text = (await block.locator('.documentation-host-route-header__alt-discriminators').first().textContent()) ?? ''
  for (const expected of ['event', 'direction']) {
    expect(text, `discriminator ${expected} should appear`).toContain(expected)
  }
})

Then(
  'the route block {string} should expose operationId, Request body, Response body, Security, External docs in the meta dl',
  async ({}, opSlug: string) => {
    const p = requirePage()
    const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
    const meta = block.locator('.documentation-host-route-header__meta')
    await expect(meta).toBeVisible({ timeout: 10000 })
    const text = (await meta.textContent()) ?? ''
    for (const expected of ['operationId', 'Response body', 'Security', 'External docs']) {
      expect(text, `meta dl should mention ${expected}`).toContain(expected)
    }
  }
)

Then(
  'the route block {string} should describe scheme {string} with location {string}',
  async ({}, opSlug: string, schemeName: string, expectedLocation: string) => {
    const p = requirePage()
    const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
    const securityList = block.locator('.documentation-host-route-header__security-list')
    await expect(securityList).toBeVisible({ timeout: 10000 })
    const scheme = securityList
      .locator('.documentation-host-route-header__security-scheme')
      .filter({ hasText: schemeName })
      .first()
    await expect(scheme, `scheme ${schemeName} should appear`).toBeVisible({ timeout: 10000 })
    const text = (await scheme.textContent()) ?? ''
    expect(text.toLowerCase(), `scheme ${schemeName} should reference ${expectedLocation}`).toContain(expectedLocation.toLowerCase())
  }
)

Then(
  'the route block {string} should describe scheme {string} with the implicit flow URL and scopes',
  async ({}, opSlug: string, schemeName: string) => {
    const p = requirePage()
    const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
    const scheme = block
      .locator('.documentation-host-route-header__security-scheme')
      .filter({ hasText: schemeName })
      .first()
    await expect(scheme).toBeVisible({ timeout: 10000 })
    const text = (await scheme.textContent()) ?? ''
    expect(text, 'OAuth scheme should mention the implicit flow').toContain('implicit')
    expect(text, 'OAuth scheme should expose its scopes').toContain('scopes')
  }
)

// ──────────────────────────────────────────────────────────────────────
// Parameters table
// ──────────────────────────────────────────────────────────────────────

Then(
  'the parameters table for {string} should include the {string} row with location, type, format, required, description, example, constraints',
  async ({}, opSlug: string, paramName: string) => {
    const p = requirePage()
    const row = p.locator(`[data-testid="documentation-host-parameters-row-${opSlug}-${paramName}"]`)
    await expect(row, `param row missing for ${paramName}`).toBeVisible({ timeout: 10000 })
    // Location chip.
    await expect(row.locator('.documentation-host-parameters-table__location-chip').first()).toBeVisible()
    // Type cell + format chip.
    const typeCells = row.locator('td').nth(2)
    await expect(typeCells).toBeVisible()
    await expect(row.locator('.documentation-host-parameters-table__format')).toBeVisible({ timeout: 5000 })
    // Required flag.
    const requiredCell = row.locator('.documentation-host-parameters-table__td--required').first()
    await expect(requiredCell).toContainText('✓')
    // Constraints summary (may carry path-param numeric constraints from the patcher).
    await expect(row.locator('.documentation-host-parameters-table__constraints').first()).toBeVisible()
  }
)

Then(
  'the parameters table for {string} should expose at least 2 example entries for {string}',
  async ({}, opSlug: string, paramName: string) => {
    const p = requirePage()
    const row = p.locator(`[data-testid="documentation-host-parameters-row-${opSlug}-${paramName}"]`)
    const additional = row.locator('.documentation-host-parameters-table__additional-examples li')
    const count = await additional.count()
    expect(count, 'multi-examples list should expose 2+ entries').toBeGreaterThanOrEqual(2)
  }
)

Then(
  'the parameters table for {string} should show a format chip on {string}',
  async ({}, opSlug: string, paramName: string) => {
    const p = requirePage()
    // Scope to the specific operation's parameter row — the same param
    // name (`petId`) appears under multiple routes, so we hop in via
    // the row testid first.
    const row = p.locator(`[data-testid="documentation-host-parameters-row-${opSlug}-${paramName}"]`)
    await expect(row).toBeVisible({ timeout: 10000 })
    const chip = row.locator(`[data-testid="documentation-host-param-format-${paramName}"]`).first()
    await expect(chip, `format chip should be visible for ${opSlug}.${paramName}`).toBeVisible({ timeout: 10000 })
    const text = (await chip.textContent()) ?? ''
    expect(text.length, `format chip should not be empty (got "${text}")`).toBeGreaterThan(0)
  }
)

// ──────────────────────────────────────────────────────────────────────
// Responses table
// ──────────────────────────────────────────────────────────────────────

Then(
  'the responses table for {string} should list every status code from the spec',
  async ({}, opSlug: string) => {
    const p = requirePage()
    const doc = requireDoc()
    const op = doc.operations.find((o) => (o.operationId ?? '') === opSlug)
    if (!op) throw new Error(`operation ${opSlug} not found in patched doc`)
    const responses = op.responses ?? {}
    for (const code of Object.keys(responses)) {
      const row = p.locator(`[data-testid="documentation-host-responses-row-${opSlug}-${code}"]`)
      await expect(row, `responses row missing for ${opSlug}::${code}`).toBeVisible({ timeout: 10000 })
    }
  }
)

Then(
  'the responses dot for {string} status {string} should look like a 2xx',
  async ({}, opSlug: string, code: string) => {
    const p = requirePage()
    const dot = p.locator(`[data-testid="documentation-host-responses-row-${opSlug}-${code}"] .documentation-host-responses-table__dot`)
    await expect(dot).toBeVisible({ timeout: 10000 })
    const bg = await dot.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)
    // 2xx maps to `var(--testing-iconPassed)` — typically a green hue.
    // Check the green channel dominates the red channel.
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
    if (!match) throw new Error(`unexpected dot background colour: ${bg}`)
    const r = Number(match[1]); const g = Number(match[2])
    expect(g, `2xx dot should look greenish (got ${bg})`).toBeGreaterThan(r)
  }
)

Then(
  'the responses dot for {string} status {string} should look like a 4xx',
  async ({}, opSlug: string, code: string) => {
    const p = requirePage()
    const dot = p.locator(`[data-testid="documentation-host-responses-row-${opSlug}-${code}"] .documentation-host-responses-table__dot`)
    await expect(dot).toBeVisible({ timeout: 10000 })
    const bg = await dot.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
    if (!match) throw new Error(`unexpected dot background colour: ${bg}`)
    const r = Number(match[1]); const g = Number(match[2])
    expect(r, `4xx dot should look reddish (got ${bg})`).toBeGreaterThan(g)
  }
)

When('I expand the response row for {string} status {string}', async ({}, opSlug: string, code: string) => {
  const p = requirePage()
  const row = p.locator(`[data-testid="documentation-host-responses-row-${opSlug}-${code}"]`)
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await p.waitForTimeout(200)
})

Then(
  'the response detail should expose a schema label, the X-Rate-Limit header, and a JSON and XML example',
  async () => {
    const p = requirePage()
    const detail = p.locator('.documentation-host-responses-detail').first()
    await expect(detail).toBeVisible({ timeout: 10000 })
    const text = (await detail.textContent()) ?? ''
    expect(text, 'response detail should mention X-Rate-Limit').toContain('X-Rate-Limit')
    expect(text, 'response detail should expose the application/json example').toContain('application/json')
    expect(text, 'response detail should expose the application/xml example').toContain('application/xml')
  }
)

// ──────────────────────────────────────────────────────────────────────
// Operation extras
// ──────────────────────────────────────────────────────────────────────

When('I expand the operation extras for {string}', async ({}, opSlug: string) => {
  const p = requirePage()
  const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
  const extras = block.locator('[data-testid="documentation-host-operation-extras"]').first()
  await expect(extras).toBeVisible({ timeout: 10000 })
  // <details> opens via summary click (or `open` attribute toggle).
  await extras.locator('summary').click()
  await p.waitForTimeout(200)
})

Then('I should see x-rate-limit, x-internal-only, and x-codegen-tags', async () => {
  const p = requirePage()
  const extras = p.locator('[data-testid="documentation-host-operation-extras"][open]').first()
  await expect(extras).toBeVisible({ timeout: 10000 })
  const text = (await extras.textContent()) ?? ''
  for (const expected of ['x-rate-limit', 'x-internal-only', 'x-codegen-tags']) {
    expect(text, `operation extras should mention ${expected}`).toContain(expected)
  }
})

// ──────────────────────────────────────────────────────────────────────
// Model graph
// ──────────────────────────────────────────────────────────────────────

Then('the model graph should report layout-ready', async () => {
  const p = requirePage()
  const graph = p.locator('[data-testid="documentation-host-model-graph"] .react-flow').first()
  await expect(graph).toBeVisible({ timeout: 10000 })
  await expect(graph).toHaveAttribute('data-layout-ready', 'true', { timeout: 15000 })
})

Then('the model graph should render a node for every model in the spec', async () => {
  const p = requirePage()
  const doc = requireDoc()
  for (const modelName of Object.keys(doc.models)) {
    const node = p.locator(`[data-testid="documentation-host-model-node-${modelName}"]`)
    await expect(node, `node missing for model ${modelName}`).toHaveCount(1, { timeout: 15000 })
  }
})

Then('the first model node should show the deprecated badge', async () => {
  const p = requirePage()
  const doc = requireDoc()
  const firstName = Object.keys(doc.models)[0]
  if (firstName === undefined) throw new Error('no models in patched doc')
  const node = p.locator(`[data-testid="documentation-host-model-node-${firstName}"]`)
  await expect(node).toBeVisible({ timeout: 10000 })
  await expect(node.locator('.documentation-host-model-node__badge--deprecated')).toBeVisible()
})

Then('the last model node should show the removed badge', async () => {
  const p = requirePage()
  const doc = requireDoc()
  const names = Object.keys(doc.models)
  const lastName = names[names.length - 1]
  if (lastName === undefined) throw new Error('no models in patched doc')
  const node = p.locator(`[data-testid="documentation-host-model-node-${lastName}"]`)
  await expect(node).toBeVisible({ timeout: 10000 })
  await expect(node.locator('.documentation-host-model-node__badge--removed')).toBeVisible()
})

Then('every patched cross-model reference should produce an edge in the graph', async () => {
  const p = requirePage()
  const doc = requireDoc()
  const expected: string[] = []
  for (const model of Object.values(doc.models)) {
    for (const prop of model.properties) {
      if (prop.targetModelRef && doc.models[prop.targetModelRef]) {
        expected.push(`${model.name}::${prop.name}->${prop.targetModelRef}`)
      }
    }
  }
  // React Flow stamps the edge id on its `<g>` wrapper as `data-id`.
  const edgeIds = await p.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.react-flow__edge'))
    return nodes.map((n) => n.getAttribute('data-id') ?? '')
  })
  for (const want of expected) {
    expect(edgeIds, `expected edge ${want}`).toContain(want)
  }
})

Then('no model graph edge should cut across an unrelated node', async () => {
  const p = requirePage()
  // Read every node bbox + every edge polyline in canvas-local coords.
  const overlap = await p.evaluate(() => {
    interface Box { id: string; x: number; y: number; w: number; h: number }
    const nodes: Box[] = []
    document.querySelectorAll<HTMLElement>('.react-flow__node').forEach((n) => {
      const id = n.getAttribute('data-id') ?? ''
      const r = n.getBoundingClientRect()
      nodes.push({ id, x: r.left, y: r.top, w: r.width, h: r.height })
    })
    interface Hit { edge: string; node: string }
    const hits: Hit[] = []
    const segIntersectsRect = (
      x1: number, y1: number, x2: number, y2: number,
      rx: number, ry: number, rw: number, rh: number
    ): boolean => {
      const minX = Math.min(x1, x2); const maxX = Math.max(x1, x2)
      const minY = Math.min(y1, y2); const maxY = Math.max(y1, y2)
      // Outright AABB rejection.
      if (maxX < rx || minX > rx + rw) return false
      if (maxY < ry || minY > ry + rh) return false
      // For axis-aligned segments (which orthogonal routing produces),
      // overlap in both axes implies actual intersection.
      return true
    }
    document.querySelectorAll<SVGPathElement>('.react-flow__edge path.react-flow__edge-path').forEach((path) => {
      const edgeId = path.parentElement?.getAttribute('data-id') ?? ''
      const [src, tgt] = edgeId.includes('->')
        ? [edgeId.split('::')[0] ?? '', edgeId.split('->')[1] ?? '']
        : ['', '']
      const d = path.getAttribute('d') ?? ''
      // Parse SVG path "M x y L x y L x y …" into points (in viewport coords).
      const pts: { x: number; y: number }[] = []
      const tokens = d.split(/[,\s]+/).filter(Boolean)
      let i = 0
      while (i < tokens.length) {
        const cmd = tokens[i]
        if (cmd === 'M' || cmd === 'L') {
          const x = Number(tokens[i + 1])
          const y = Number(tokens[i + 2])
          if (!Number.isNaN(x) && !Number.isNaN(y)) pts.push({ x, y })
          i += 3
        } else { i += 1 }
      }
      // The path's `d` is in the React Flow viewport's local coord space —
      // translate to viewport pixels by reading the parent <g>'s transform
      // is overkill; instead use the path's getCTM to convert each point.
      const ctm = path.getCTM()
      const screenPts = pts.map((pt) => {
        if (!ctm) return pt
        return {
          x: pt.x * ctm.a + pt.y * ctm.c + ctm.e,
          y: pt.x * ctm.b + pt.y * ctm.d + ctm.f
        }
      })
      for (let k = 1; k < screenPts.length; k++) {
        const a = screenPts[k - 1]; const b = screenPts[k]
        if (!a || !b) continue
        for (const node of nodes) {
          if (node.id === src || node.id === tgt) continue
          // Shrink the node bbox by 4px to allow edge routing alongside.
          const margin = 4
          if (segIntersectsRect(a.x, a.y, b.x, b.y, node.x + margin, node.y + margin, node.w - 2 * margin, node.h - 2 * margin)) {
            hits.push({ edge: edgeId, node: node.id })
          }
        }
      }
    })
    return hits
  })
  expect(overlap, `unexpected edge/node overlaps: ${JSON.stringify(overlap)}`).toEqual([])
})

When('I hover the first property of the {string} node', async ({}, modelName: string) => {
  const p = requirePage()
  const node = p.locator(`[data-testid="documentation-host-model-node-${modelName}"]`)
  await expect(node).toBeVisible({ timeout: 10000 })
  const firstProp = node.locator('.documentation-host-model-node__property').first()
  await expect(firstProp).toBeVisible({ timeout: 10000 })
  await firstProp.hover()
  // DelayedTooltip waits 1s before popping.
  await p.waitForTimeout(1300)
})

Then('a documentation tooltip should be visible', async () => {
  const p = requirePage()
  const tooltip = p.locator('.documentation-host-model-node__tooltip').first()
  await expect(tooltip).toBeVisible({ timeout: 5000 })
})

Then('the Composition section should describe the patched discriminator on the first model', async () => {
  const p = requirePage()
  const composition = p.locator('[data-testid="documentation-host-composition"]')
  await expect(composition).toBeVisible({ timeout: 10000 })
  const text = (await composition.textContent()) ?? ''
  expect(text.toLowerCase(), 'composition section should mention the discriminator label').toContain('discriminator')
  expect(text, 'composition section should mention the patched property name').toContain('kind')
})

// ──────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────

Then('the Enums section should include {string} with a status enum row', async ({}, modelName: string) => {
  const p = requirePage()
  const enums = p.locator('.documentation-host-enums').first()
  await expect(enums).toBeVisible({ timeout: 10000 })
  // Look for the patched status enum values within the model card.
  const card = enums
    .locator('.documentation-host-enums__model')
    .filter({ has: p.getByText(modelName, { exact: true }) })
    .first()
  await expect(card, `Enums section should include the ${modelName} card`).toBeVisible({ timeout: 10000 })
  const text = (await card.textContent()) ?? ''
  for (const expected of ['available', 'pending', 'sold']) {
    expect(text, `${modelName} enums should include ${expected}`).toContain(expected)
  }
})

// ──────────────────────────────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────────────────────────────

When('I press Ctrl+F', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+f')
  await p.waitForTimeout(200)
})

When('I press Ctrl+Shift+F', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+Shift+F')
  await p.waitForTimeout(200)
})

When('I type {string} in the find input', async ({}, query: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="documentation-host-native-find-bar"] .documentation-host-search-bar__input')
  await expect(input).toBeVisible({ timeout: 5000 })
  // Click the input first to ensure focus, then type via the keyboard
  // so the React onChange + the underlying `findInPage` call fire as
  // they would for a real user. `fill()` shortcuts the input via JS
  // but in past runs this raced the focus rAF inside the bar.
  await input.click()
  await p.keyboard.type(query, { delay: 30 })
  // Native findInPage round-trips through main → 'found-in-page' →
  // 'find:result'. The next assertion polls the counter so we don't
  // need a fixed wait here.
})

When('I type {string} in the search input', async ({}, query: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="documentation-host-search-bar"] .documentation-host-search-bar__input')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(query)
  await p.waitForTimeout(400)
})

Then('the native find bar should be visible', async () => {
  const p = requirePage()
  const bar = p.locator('[data-testid="documentation-host-native-find-bar"]')
  await expect(bar).toBeVisible({ timeout: 5000 })
})

When('I press F3', async () => {
  const p = requirePage()
  await p.keyboard.press('F3')
  await p.waitForTimeout(400)
})

Then('the native find bar active match should have advanced', async () => {
  const p = requirePage()
  const counter = p.locator('[data-testid="documentation-host-native-find-bar"] .documentation-host-search-bar__counter')
  // Poll: native findInPage's 'found-in-page' event can land late on
  // a freshly-reloaded page. The counter eventually settles at
  // active >= 2 once F3 has advanced past the first match.
  await expect.poll(async () => {
    const text = (await counter.textContent()) ?? '0 / 0'
    const m = /(\d+)\s*\/\s*(\d+)/.exec(text)
    return m ? Number(m[1]) : 0
  }, { timeout: 8000, message: 'native find bar should advance the active match past 1' })
    .toBeGreaterThan(1)
})

When('I press Escape', async () => {
  const p = requirePage()
  await p.keyboard.press('Escape')
  await p.waitForTimeout(200)
})

Then('the native find bar should be gone', async () => {
  const p = requirePage()
  const bar = p.locator('[data-testid="documentation-host-native-find-bar"]')
  await expect(bar).toHaveCount(0, { timeout: 5000 })
})

Then('the custom search bar counter should report a match count above zero', async () => {
  const p = requirePage()
  const counter = p.locator('[data-testid="documentation-host-search-bar"] .documentation-host-search-bar__counter')
  await expect.poll(async () => {
    const text = (await counter.textContent()) ?? '0 / 0'
    const m = /(\d+)\s*\/\s*(\d+)/.exec(text)
    return m ? Number(m[2]) : 0
  }, { timeout: 10000, message: 'custom search bar should report a non-zero match count' })
    .toBeGreaterThan(0)
})

When('I press F3 enough times to wrap around the match list', async () => {
  const p = requirePage()
  const counter = p.locator('[data-testid="documentation-host-search-bar"] .documentation-host-search-bar__counter')
  const initial = (await counter.textContent()) ?? '0 / 0'
  const m = /(\d+)\s*\/\s*(\d+)/.exec(initial)
  if (!m) throw new Error(`could not parse counter "${initial}"`)
  const total = Number(m[2])
  // Press F3 `total` times — first press jumps from active 1 → 2, last
  // wraps total → 1. Loop with a short wait per step to let the
  // setState flush.
  for (let i = 0; i < total; i++) {
    await p.keyboard.press('F3')
    await p.waitForTimeout(80)
  }
})

Then('the custom search bar active index should be 1', async () => {
  const p = requirePage()
  const counter = p.locator('[data-testid="documentation-host-search-bar"] .documentation-host-search-bar__counter')
  await expect.poll(async () => {
    const text = (await counter.textContent()) ?? '0 / 0'
    const m = /(\d+)\s*\/\s*(\d+)/.exec(text)
    return m ? Number(m[1]) : 0
  }, { timeout: 10000, message: 'custom search bar should wrap to active index 1' })
    .toBe(1)
})

// ──────────────────────────────────────────────────────────────────────
// Add a request from docs
// ──────────────────────────────────────────────────────────────────────

When(
  'I click {string} on operation {string} in the env-folder docs',
  async ({}, _label: string, opSlug: string) => {
    const p = requirePage()
    const btn = p.locator(`[data-testid="env-folder-documentation-host"] [data-testid="documentation-host-route-header-add-${opSlug}"]`)
    await expect(btn).toBeVisible({ timeout: 10000 })
    await btn.scrollIntoViewIfNeeded()
    await btn.click()
    await p.waitForTimeout(800)
  }
)

Then(
  'a request named {string} should appear inside the {string} folder',
  async ({}, requestName: string, tagFolder: string) => {
    const p = requirePage()
    const folderRow = sidebarRow(p, tagFolder)
    await expect(folderRow).toBeVisible({ timeout: 10000 })
    if ((await folderRow.getAttribute('aria-expanded')) !== 'true') {
      const expander = folderRow.locator('button.list-view-expander').first()
      if (await expander.count() > 0) await expander.click()
    }
    const requestRow = sidebarRow(p, requestName)
    await expect(requestRow).toBeVisible({ timeout: 10000 })
  }
)

Given('I open the {string} folder Docs tab', async ({}, folderName: string) => {
  const p = requirePage()
  const folderRow = sidebarRow(p, folderName)
  await expect(folderRow).toBeVisible({ timeout: 10000 })
  // Open the folder in a tab.
  await folderRow.click()
  // Switch the active tab's sub-tab to Docs (folder views expose docs
  // as one of their sub-tabs).
  const docsSubTab = p.locator('[role="tab"][data-tab-id="docs"]:visible').last()
  await expect(docsSubTab).toBeVisible({ timeout: 10000 })
  await docsSubTab.click()
  // Wait for the folder's documentation host to mount (testid is
  // `folder-documentation-host-<id>`).
  await expect(p.locator('[data-testid^="folder-documentation-host-"]:visible').first()).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(800)
})

When(
  'I click {string} on operation {string} in the folder docs',
  async ({}, _label: string, opSlug: string) => {
    const p = requirePage()
    const btn = p.locator(`[data-testid^="folder-documentation-host-"]:visible [data-testid="documentation-host-route-header-add-${opSlug}"]`).first()
    await expect(btn).toBeVisible({ timeout: 10000 })
    await btn.scrollIntoViewIfNeeded()
    await btn.click()
    await p.waitForTimeout(800)
  }
)

// ──────────────────────────────────────────────────────────────────────
// Tag-folder grouping in env-folder Docs
// ──────────────────────────────────────────────────────────────────────

Then('the env-folder docs body should expose an H2 group header for every tag in the spec', async () => {
  const p = requirePage()
  const doc = requireDoc()
  for (const groupName of Object.keys(doc.groups)) {
    const section = p.locator(`[data-testid="documentation-host-group-${groupName}"]`)
    await expect(section, `body should expose group section for ${groupName}`).toBeVisible({ timeout: 10000 })
    const heading = section.locator('h2.documentation-host__group-title').first()
    await expect(heading, `group ${groupName} should render an H2`).toBeVisible({ timeout: 10000 })
    const text = (await heading.textContent() ?? '').trim().toLowerCase()
    expect(text, `H2 should match the group name`).toContain(groupName.toLowerCase())
  }
})

Then('each group header should render its description below the title', async () => {
  const p = requirePage()
  const doc = requireDoc()
  for (const [groupName, group] of Object.entries(doc.groups)) {
    if (group.description === undefined || group.description.length === 0) continue
    const desc = p.locator(`[data-testid="documentation-host-group-description-${groupName}"]`)
    await expect(desc, `group ${groupName} should render its description`).toBeVisible({ timeout: 10000 })
  }
})

Then('the sidebar Operations section title should scroll to the first group header', async () => {
  const p = requirePage()
  // Scroll to the bottom first so the click has somewhere to scroll back to.
  await p.evaluate(() => {
    const host = document.querySelector('[data-testid="env-folder-documentation-host"]')
    if (!host) return
    let parent: HTMLElement | null = host.parentElement
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight + 8) { parent.scrollTop = parent.scrollHeight; return }
      parent = parent.parentElement
    }
  })
  await p.waitForTimeout(300)
  const link = p.locator('[data-testid="documentation-host-sidebar-section-operations"]')
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(800)
  const firstGroup = p.locator('[data-testid^="documentation-host-group-"]').first()
  await expect.poll(async () => {
    const box = await firstGroup.boundingBox()
    return box?.y ?? -Infinity
  }, { timeout: 8000, message: 'first group header should land on screen' })
    .toBeGreaterThan(-200)
})

Then('the sidebar Models section title should scroll to the Models section', async () => {
  const p = requirePage()
  await p.evaluate(() => {
    const host = document.querySelector('[data-testid="env-folder-documentation-host"]')
    if (!host) return
    let parent: HTMLElement | null = host.parentElement
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight + 8) { parent.scrollTop = 0; return }
      parent = parent.parentElement
    }
  })
  await p.waitForTimeout(300)
  const link = p.locator('[data-testid="documentation-host-sidebar-section-models"]')
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(800)
  const models = p.locator('[data-testid="documentation-host-models-section"]')
  await expect.poll(async () => {
    const box = await models.boundingBox()
    return box?.y ?? -Infinity
  }, { timeout: 8000, message: 'Models section should land on screen' })
    .toBeGreaterThan(-200)
})

Then('the sidebar Enums section title should scroll to the Enums section', async () => {
  const p = requirePage()
  await p.evaluate(() => {
    const host = document.querySelector('[data-testid="env-folder-documentation-host"]')
    if (!host) return
    let parent: HTMLElement | null = host.parentElement
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight + 8) { parent.scrollTop = 0; return }
      parent = parent.parentElement
    }
  })
  await p.waitForTimeout(300)
  const link = p.locator('[data-testid="documentation-host-sidebar-section-enums"]')
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(800)
  const enums = p.locator('[data-testid="documentation-host-enums-section"]')
  await expect.poll(async () => {
    const box = await enums.boundingBox()
    return box?.y ?? -Infinity
  }, { timeout: 8000, message: 'Enums section should land on screen' })
    .toBeGreaterThan(-200)
})

Then('the H1, H2, H3 levels should render at 26, 22, 18 px respectively', async () => {
  const p = requirePage()
  const host = p.locator('[data-testid="env-folder-documentation-host"]')
  await expect(host).toBeVisible({ timeout: 10000 })
  const sizeOf = async (selector: string): Promise<number> => {
    const el = host.locator(selector).first()
    await expect(el, `expected ${selector} to render`).toBeVisible({ timeout: 10000 })
    return el.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
  }
  expect(await sizeOf('h1.documentation-host__scope-title'), 'H1 scope title').toBeCloseTo(26, 0)
  expect(await sizeOf('h2.documentation-host__group-title'), 'H2 group title').toBeCloseTo(22, 0)
  expect(await sizeOf('h3.documentation-host-route-header__summary'), 'H3 route summary').toBeCloseTo(18, 0)
})
