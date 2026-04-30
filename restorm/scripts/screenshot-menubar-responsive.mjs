#!/usr/bin/env node
/**
 * Captures the restorm titlebar at three widths so we can eyeball the
 * responsive `MenuBar` overflow + hamburger behaviour:
 *
 *   - Wide   (1400 px) → all 6 menus inline, no overflow button.
 *   - Medium ( 700 px) → trailing "..." button picks up the overflowed tail.
 *   - Narrow ( 180 px) → single hamburger "☰" button holds every menu.
 *
 * Run from `restorm/`:
 *
 *   node scripts/screenshot-menubar-responsive.mjs
 *
 * Outputs to `tests/e2e/.tmp/screenshots/menubar-{wide,medium,narrow}.png`.
 * Requires `pnpm run build` to have produced `dist/main/index.js`.
 */
import { _electron as electron } from '@playwright/test'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
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

async function setWindowWidth(width) {
  await app.evaluate(async ({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setBounds({ x: 100, y: 100, width: w, height: 800 })
  }, width)
  await page.waitForTimeout(400)
}

async function captureClosed(width, label) {
  await setWindowWidth(width)
  const bar = page.locator('[data-testid="titlebar-menubar"]')
  const mode = await bar.getAttribute('data-mode')
  const visible = await bar.getAttribute('data-visible-count')
  console.log(`width=${width} → mode=${mode} visibleCount=${visible}`)
  await page.screenshot({
    path: join(outDir, `menubar-${label}.png`),
    clip: { x: 0, y: 0, width, height: 80 }
  })
}

async function captureOpen(width, label, buttonTestId) {
  // The bar must already be at the right width (set in the closed
  // capture immediately above). We just click + screenshot here —
  // attempting to resize between modes is fragile because flex
  // distribution drifts across narrow ↔ wide transitions.
  await page.locator(buttonTestId).click({ force: true, timeout: 5000 })
  await page.waitForTimeout(300)
  await page.screenshot({
    path: join(outDir, `menubar-${label}-open.png`),
    clip: { x: 0, y: 0, width: Math.max(width, 360), height: 360 }
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

await captureClosed(1400, 'wide')
await captureClosed(600, 'medium')
await captureOpen(600, 'medium', '[data-testid="titlebar-menubar-overflow-button"]')
await captureClosed(480, 'narrow')
await captureOpen(480, 'narrow', '[data-testid="titlebar-menubar-hamburger-button"]')

console.log(`Screenshots written under ${outDir}`)
await app.close()
