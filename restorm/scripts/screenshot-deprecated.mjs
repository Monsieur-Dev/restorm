#!/usr/bin/env node
/**
 * One-off screenshot capture for the deprecated-route visual.
 * Boots the app via Playwright Electron, opens the bundled
 * Petstore.restorm sample, expands the sidebar to the deprecated
 * `Finds Pets by tags` route, captures the sidebar dim. Then opens
 * the request tab, captures the orange callout under the breadcrumb.
 *
 * Run from `restorm/`:
 *
 *   node scripts/screenshot-deprecated.mjs
 *
 * Outputs into `tests/e2e/.tmp/screenshots/`. Requires `npm run build`
 * to have produced `dist/main/index.js`.
 */
import { _electron as electron } from '@playwright/test'
import { configureNextSaveFileDialogForE2E, installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import electronPath from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const restormRoot = join(__filename, '../..')

const outDir = join(restormRoot, 'tests/e2e/.tmp/screenshots')
mkdirSync(outDir, { recursive: true })

const userDataDir = join(restormRoot, 'tests/e2e/.tmp/userdata', randomUUID())
mkdirSync(userDataDir, { recursive: true })

const swaggerPath = join(restormRoot, 'tests/unit/swagger-petstore.json')

const mainJsPath = join(restormRoot, 'dist/main/index.js')

const app = await electron.launch({
  executablePath: electronPath,
  args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath],
  env: {
    ...process.env,
    NODE_ENV: 'development',
    RESTORM_USER_DATA_OVERRIDE: userDataDir
  }
})

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForLoadState('load')
await page.waitForSelector('[data-testid="titlebar-menubar"]', { timeout: 15000 })

await installSystemModalsMockingForE2E(app)

// Create a new single-file project so the import has a target.
const newProjectPath = join(userDataDir, 'screenshot-deprecated.restorm')
await configureNextSaveFileDialogForE2E(app, { kind: 'saveFile', path: newProjectPath })

await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()
await page.locator('[data-testid="save-options-modal"]').waitFor({ timeout: 3000 })
await page.locator('[data-testid="save-mode-file"]').click()
await page.locator('[data-testid="save-format-yaml"]').click()
await page.locator('[data-testid="save-confirm-button"]').click()
await page.locator('[data-testid="save-options-modal"]').waitFor({ state: 'detached', timeout: 5000 })
await page.waitForTimeout(500)

// Open the import modal (Ctrl+I) and paste the local swagger path.
await page.keyboard.press('Control+I')
await page.locator('[data-testid="import-modal"]').waitFor({ timeout: 3000 })
await page.locator('[data-testid="source-input-input"]').fill(swaggerPath)

// Wait for the preview tree to render.
await page.locator('[data-testid="import-selection-tree"]').waitFor({ timeout: 15000 })
await page.waitForTimeout(500)

// Confirm import.
await page.locator('[data-testid="import-button"]').click()
await page.locator('[data-testid="import-modal"]').waitFor({ state: 'detached', timeout: 10000 })
await page.waitForTimeout(800)

async function expandRow(name) {
  const row = page
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
  if ((await row.count()) === 0) return
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await page.waitForTimeout(200)
}

// Drill into the imported tree.
await expandRow('Swagger Petstore')
await expandRow('pet')
await page.waitForTimeout(400)

await page.screenshot({ path: join(outDir, 'sidebar-deprecated.png'), fullPage: true })

// Click the deprecated row to open the request tab.
const deprecatedRow = page
  .locator('[data-testid="sidebar-listview"] .list-view-row')
  .filter({ has: page.getByText('Finds Pets by tags', { exact: true }) })
  .first()
await deprecatedRow.click()
await page.waitForTimeout(1200)
await page.screenshot({ path: join(outDir, 'request-tab-deprecated.png'), fullPage: true })

console.log(`Screenshots written under ${outDir}`)
await app.close()
