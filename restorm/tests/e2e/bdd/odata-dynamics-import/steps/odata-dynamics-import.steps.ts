import { createBdd } from 'playwright-bdd'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  test,
  expect,
  DYNAMICS_CREDS_PATH,
  loadDynamicsCredsOrSkip,
  ODATA_DYNAMICS_TEMP_DIR,
  configureNextSaveFileDialogForE2E,
  type DynamicsCreds
} from '../../fixtures/odata-dynamics-import.fixture'

const SINGLE_FILE = join(ODATA_DYNAMICS_TEMP_DIR, 'dynamics-import.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let creds: DynamicsCreds | null = null

// Timing buckets persisted across steps so the final "report" step
// can dump them all together. We also mirror to a stable file after
// every mark so a mid-run failure still leaves partial timings on
// disk for inspection.
const timings: Record<string, number> = {}
const markNow = (label: string): void => {
  timings[label] = Date.now()
  try {
    mkdirSync(ODATA_DYNAMICS_TEMP_DIR, { recursive: true })
    writeFileSync(
      join(ODATA_DYNAMICS_TEMP_DIR, 'latest-timings.json'),
      JSON.stringify({ timestamps: timings }, null, 2),
      'utf-8'
    )
  } catch { /* ignore */ }
}
const elapsed = (from: string, to = 'now'): number => {
  const start = timings[from]
  if (start === undefined) return -1
  const end = to === 'now' ? Date.now() : timings[to]
  if (end === undefined) return -1
  return end - start
}

Given('a new single-file YAML collection for the dynamics import', async ({ launchApp }) => {
  // The scenario is opt-in at the playwright.config level — it only
  // runs when `RUN_ODATA_DYNAMICS_PERF=1` is set. Credentials still
  // have to be provisioned locally (gitignored `dynamics-creds.json`)
  // and we fail loud here if they are missing.
  if (!existsSync(DYNAMICS_CREDS_PATH)) {
    throw new Error(`dynamics-creds.json missing at ${DYNAMICS_CREDS_PATH} — provision the file to run this suite.`)
  }
  creds = loadDynamicsCredsOrSkip()

  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(electronApp, { kind: 'saveFile', path: SINGLE_FILE })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  const modal = page.locator('[data-testid="save-options-modal"]')
  await expect(modal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="save-mode-file"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(modal).not.toBeVisible({ timeout: 2000 })
  await page.waitForTimeout(500)

  markNow('collection-ready')
})

When('I open the import modal and paste the dynamics metadata URL', async () => {
  if (!page || !creds) throw new Error('app must be launched + creds must be loaded')

  await page.keyboard.press('Control+I')
  const importModal = page.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })

  const input = importModal.locator('textarea, input[type="text"]').first()
  markNow('preview-fetch-start')
  await input.fill(creds.metadataUrl)

  // Initial fetch will 401 (no auth yet). We only care that the
  // modal reacted — the auth route setup comes next.
  await page.waitForTimeout(1500)
  markNow('preview-fetch-settled')
})

When('I configure the dynamics OAuth token route and save it', async () => {
  if (!page || !creds) throw new Error('app must be launched + creds must be loaded')

  await page.locator('[data-testid="import-add-auth-button"]').click()
  const authModal = page.locator('[data-testid="authentication-setup-modal"]')
  await expect(authModal).toBeVisible({ timeout: 2000 })

  // POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
  // InputBox's `data-testid` lands on a hidden marker; the actual
  // `<input>` gets a `-input` suffix.
  await page.locator('[data-testid="local-auth-form-url-input-input"]').fill(creds.tokenUrl)

  // Content-Type header (form-urlencoded is required). Headers table
  // seeds with a single empty row — reuse it instead of adding a
  // second empty one and leaving the first blank.
  const headersTable = page.locator('[data-testid="local-auth-form-headers-table"]')
  const headerRow = headersTable.locator('tbody tr').first()
  await headerRow.locator('td').nth(2).locator('input').first().fill('Content-Type')
  await headerRow.locator('td').nth(3).locator('input').first().fill('application/x-www-form-urlencoded')

  // Switch body to x-www-form-urlencoded and fill the 4 OAuth fields.
  const bodyModeRadio = page.locator('[data-testid="local-auth-form-body-mode"]')
  await bodyModeRadio.getByText('x-www-form-urlencoded').click()

  const addFieldBtn = page.locator('[data-testid="local-auth-form-add-body-field-button"]')
  const fieldsTable = page.locator('[data-testid="local-auth-form-body-fields-table"]')
  const fill = async (key: string, value: string): Promise<void> => {
    await addFieldBtn.click()
    const row = fieldsTable.locator('tbody tr').last()
    await row.locator('td').nth(2).locator('input').first().fill(key)
    await row.locator('td').nth(3).locator('input').first().fill(value)
  }
  // First row already exists as an empty placeholder — reuse it for
  // grant_type instead of adding a fresh one.
  const firstFieldRow = fieldsTable.locator('tbody tr').first()
  await firstFieldRow.locator('td').nth(2).locator('input').first().fill('grant_type')
  await firstFieldRow.locator('td').nth(3).locator('input').first().fill('client_credentials')
  await fill('client_id', creds.clientId)
  await fill('client_secret', creds.clientSecret)
  await fill('scope', creds.scope)

  // Fire the inline Send to validate the route — on 2xx the auth form
  // auto-fills Authorization + expiration and jumps to Configuration.
  markNow('auth-send-start')
  await page.locator('[data-testid="local-auth-form-send-button"]').click()
  // Wait for the Response tab to appear + expose the token_type.
  await expect(page.locator('[data-testid="local-auth-form-produced-headers-table"]')).toBeVisible({ timeout: 30000 })
  markNow('auth-send-settled')

  // Close the auth modal via OK — this also re-fires the auth
  // prefetch and hands the resolved headers back to the import.
  markNow('save-retry-start')
  await page.locator('[data-testid="authentication-setup-attach"]').click()
  await expect(page.locator('[data-testid="authentication-setup-modal"]')).not.toBeVisible({ timeout: 30000 })

  // Import modal should now show the preview of thousands of routes.
  // Backend parses the full EDMX (10k+ entities + actions + funcs)
  // after we hand over the resolved auth headers — this can take a
  // while, and it's NOT the optimization target. We measure it but
  // give it a generous ceiling.
  await expect(page.locator('[data-testid="import-modal"] .import-preview-section')).toBeVisible({ timeout: 180000 })
  markNow('import-preview-ready')
})

When('I click Import and wait for the sidebar to be populated', async () => {
  if (!page) throw new Error('app must be launched')

  const importButton = page.locator('[data-testid="import-button"]')
  await expect(importButton).toBeVisible({ timeout: 2000 })
  // The button label carries the leaf-request count — record it.
  const label = (await importButton.textContent()) ?? ''
  timings['preview-count'] = Number((/\((\d+)\)/.exec(label)?.[1] ?? '0'))

  markNow('import-click')
  await importButton.click()

  // Wait for the import modal to close (import dispatched) and for
  // the sidebar tree to render at least one imported folder.
  await expect(page.locator('[data-testid="import-modal"]')).not.toBeVisible({ timeout: 60000 })

  // Wait for the sidebar ListView row count to stabilize as a proxy
  // for "sidebar populated". `.ecui-list-view-item` is the row class
  // the ListView component renders — a count that stops growing for
  // STABLE_THRESHOLD_MS means React has committed the final tree.
  const treeRows = page.locator('[data-testid="sidebar-listview"] .ecui-list-view-item')
  let lastCount = -1
  let stableFor = 0
  const STABLE_THRESHOLD_MS = 1500
  const POLL_INTERVAL_MS = 250
  const deadline = Date.now() + 300000
  while (Date.now() < deadline) {
    const n = await treeRows.count()
    if (n > 0 && n === lastCount) {
      stableFor += POLL_INTERVAL_MS
      if (stableFor >= STABLE_THRESHOLD_MS) break
    } else {
      stableFor = 0
    }
    lastCount = n
    await page.waitForTimeout(POLL_INTERVAL_MS)
  }
  markNow('sidebar-populated')
  timings['sidebar-tree-items'] = lastCount
})

Then('the collection contains the dynamics authentication route', async () => {
  if (!page) throw new Error('app must be launched')

  // Auth request lives inside the first imported folder (see
  // ImportModal.handleImportClick — non-folder root items would be
  // dropped by useImport's empty-file path, so we nest it). Search
  // by label within the sidebar.
  const authNode = page.locator(
    '[data-testid="sidebar-listview"] .ecui-list-view-item',
    { hasText: 'Authentication route' }
  ).first()
  await expect(authNode).toBeVisible({ timeout: 10000 })
})

Then('a non-auth request shows the dynamics auth selected in the status bar', async () => {
  if (!page) throw new Error('app must be launched')

  // Click the first ListView row whose label isn't the auth route
  // nor a folder. ODATA requests are the numerous leaves.
  const candidates = page
    .locator('[data-testid="sidebar-listview"] .ecui-list-view-item')
    .filter({ hasNotText: 'Authentication route' })
  const first = candidates.first()
  await expect(first).toBeVisible({ timeout: 10000 })
  markNow('first-request-click')
  await first.click()
  await page.waitForTimeout(1000)
  markNow('first-request-open')

  // Status bar auth selector should exist (exact label depends on
  // what the user named the route — smoke check is enough).
  const statusAuth = page.locator('[data-testid="statusbar-auth-selector"]')
  await expect(statusAuth).toBeVisible({ timeout: 5000 })
})

Then('import timings are reported', async ({}, testInfo) => {
  if (!page) throw new Error('app must be launched')

  const report = {
    viewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    counts: {
      previewCount: timings['preview-count'],
      sidebarTreeItems: timings['sidebar-tree-items']
    },
    durationsMs: {
      previewFetch: elapsed('preview-fetch-start', 'preview-fetch-settled'),
      authSend: elapsed('auth-send-start', 'auth-send-settled'),
      saveRetryToPreview: elapsed('save-retry-start', 'import-preview-ready'),
      clickImportToSidebar: elapsed('import-click', 'sidebar-populated'),
      clickRequestToOpen: elapsed('first-request-click', 'first-request-open')
    },
    timestamps: timings
  }

  mkdirSync(ODATA_DYNAMICS_TEMP_DIR, { recursive: true })
  const reportPath = join(ODATA_DYNAMICS_TEMP_DIR, 'timings.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  await testInfo.attach('import-timings', { path: reportPath, contentType: 'application/json' })

  // Mirror to a stable path so I can read it from Claude between runs
  // without hunting through the test-results/<hash> folder.
  writeFileSync(
    join(ODATA_DYNAMICS_TEMP_DIR, 'latest-timings.json'),
    JSON.stringify(report, null, 2),
    'utf-8'
  )

  // Sanity: the slow one we're trying to fix is clickImportToSidebar.
  // No hard assertion yet — this is a baseline measurement run. We
  // still validate the count was non-zero so the run proves anything.
  expect(report.counts.previewCount, 'preview count should be > 0').toBeGreaterThan(0)
  expect(report.counts.sidebarTreeItems, 'sidebar should have items').toBeGreaterThan(0)
})
