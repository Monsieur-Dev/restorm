#!/usr/bin/env node
// Launches the built app, imports the petstore OData metadata, saves
// the file, relaunches against it, and takes screenshots of the
// OData UI features implemented in OYO-180.
//
// Requires the odata-petstore docker service to be up on :5100 and a
// fresh `npm run build`.
//
// Outputs to /tmp/odata-screens/*.png.

import { _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'

const restormRoot = resolve(process.cwd())
const mainJsPath = join(restormRoot, 'dist/main/index.js')
const outDir = '/tmp/odata-screens'
const seedFile = '/tmp/odata-demo.restorm'

if (!existsSync(mainJsPath)) {
  console.error(`dist/main/index.js not found — run npm run build first`)
  process.exit(1)
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const electronExePath = typeof electronPath === 'string' ? electronPath : electronPath.default

async function snap(page, name) {
  const path = join(outDir, `${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`  ✓ ${path}`)
}

async function main() {
  console.log('Launching app…')
  const app = await electron.launch({
    executablePath: electronExePath,
    args: [
      '--no-sandbox',
      '--ozone-platform=x11',
      mainJsPath,
      '--open',
      seedFile
    ],
    env: { ...process.env, NODE_ENV: 'development' }
  })
  app.process().stdout?.on('data', (b) => process.stdout.write(`[main] ${b}`))
  app.process().stderr?.on('data', (b) => process.stderr.write(`[main:err] ${b}`))
  const page = await app.firstWindow()
  page.on('console', (msg) => console.log(`[renderer:${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}\n${err.stack ?? ''}`))
  await page.waitForLoadState('load')
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
  await page.waitForTimeout(2500)

  // If welcome screen is showing, click the recent file entry.
  const welcomeRecent = page.locator('text=odata-demo').first()
  if (await welcomeRecent.isVisible().catch(() => false)) {
    console.log('Welcome screen visible, clicking recent file…')
    await welcomeRecent.click()
    await page.waitForTimeout(2000)
  }

  await snap(page, '00-workspace-loaded')

  // Sidebar navigation — match the full-workflow e2e helpers: click
  // the expander chevron to open a folder, click the row body to
  // open a request in a new tab.
  function sidebarRow(title) {
    return page
      .locator('[data-testid="sidebar-listview"] .list-view-row')
      .filter({ has: page.getByText(title, { exact: true }) })
      .first()
  }

  async function expandByTitle(text) {
    const row = sidebarRow(text)
    await row.scrollIntoViewIfNeeded().catch(() => {})
    const already = await row.getAttribute('aria-expanded').catch(() => null)
    if (already === 'true') return
    const expander = row.locator('button.list-view-expander').first()
    await expander.click({ timeout: 5000 })
    await page.waitForTimeout(400)
  }

  async function clickByTitle(text) {
    const row = sidebarRow(text)
    await row.scrollIntoViewIfNeeded().catch(() => {})
    await row.click({ timeout: 5000 })
    await page.waitForTimeout(800)
  }

  console.log('Opening List Pets (Pets folder)…')
  await expandByTitle('OData.PetStore.Models')
  await expandByTitle('Pets')
  await clickByTitle('List Pets')

  await snap(page, '01-entity-set-view')

  // Expand the $expand row to show the nested options (preloaded).
  const expandToggle = page.locator('[data-testid="odata-expand-toggle-0"]').first()
  if (await expandToggle.isVisible().catch(() => false)) {
    await expandToggle.click()
    await page.waitForTimeout(400)
    const expandToggle2 = page.locator('[data-testid="odata-expand-toggle-1"]').first()
    if (await expandToggle2.isVisible().catch(() => false)) {
      await expandToggle2.click()
      await page.waitForTimeout(400)
    }
    await snap(page, '02-expand-nested-options')
  }

  // Send the request (hits docker petstore on :5100).
  console.log('Sending entity-set request…')
  await page.locator('[data-testid="odata-request-send"]').click()
  await page.waitForTimeout(2500)
  await snap(page, '03-response-view')

  const infosTab = page.locator('[role="tab"]:has-text("Infos")').first()
  if (await infosTab.isVisible().catch(() => false)) {
    await infosTab.click()
    await page.waitForTimeout(800)
    await snap(page, '04-infos-tab')
  }

  // Actions > AdoptPet — action parameter form.
  console.log('Opening Action AdoptPet…')
  await expandByTitle('Actions')
  const adoptRow = page.locator('[data-testid="sidebar-listview"] .list-view-row', {
    has: page.getByText('Action AdoptPet', { exact: false })
  }).first()
  await adoptRow.click({ timeout: 5000 })
  await page.waitForTimeout(1000)
  await snap(page, '05-action-param-form')

  // Functions > GetAvailablePets — function parameter form.
  console.log('Opening Function GetAvailablePets…')
  await expandByTitle('Functions')
  await clickByTitle('Function GetAvailablePets')
  await snap(page, '06-function-param-form')

  // Batch demo — structured sub-request list.
  console.log('Opening Batch demo…')
  await expandByTitle('Batch demo')
  const batchRow = page.locator('[data-testid="sidebar-listview"] .list-view-row', {
    has: page.getByText('Batch two reads', { exact: false })
  }).first()
  await batchRow.click({ timeout: 5000 })
  await page.waitForTimeout(1000)
  await snap(page, '07-batch-editor')

  console.log('Done. Screenshots in', outDir)
  await app.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
