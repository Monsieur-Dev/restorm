import { createBdd } from 'playwright-bdd'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect, SWAGGER_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E } from '../../fixtures/swagger-import.fixture'

function activeEnvFolderBookmarks(currentPage: Page): Locator {
  return currentPage.locator('[data-testid^="tab-env-folder-idx:"][data-testid$="-bookmarks"]').first()
}

const SAMPLES_DIR = resolve(__dirname, '../../../../unit')
const SINGLE_FILE = join(SWAGGER_IMPORT_TEMP_DIR, 'petstore-test.restorm')
const FOLDER_PATH = join(SWAGGER_IMPORT_TEMP_DIR, 'petstore-folder')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

Given('a new single-file YAML collection', async ({ launchApp }) => {
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
})

When('I import the Petstore swagger', async () => {
  if (!page) throw new Error('app must be launched')

  const samplePath = join(SAMPLES_DIR, 'swagger-petstore.json')
  expect(existsSync(samplePath)).toBe(true)

  await page.keyboard.press('Control+I')
  const importModal = page.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(samplePath)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 2000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 2000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 2000 })
})

When('I close the active workbench tab', async () => {
  if (!page) throw new Error('app must be launched')

  const activeTab = page.locator('.tab[role="tab"][aria-selected="true"]').first()
  await expect(activeTab).toBeVisible({ timeout: 2000 })
  await activeTab.locator('button[aria-label="Close"]').first().click()
  await page.waitForTimeout(300)
})

When('I save as folder in YAML format', async () => {
  if (!page || !electronApp) throw new Error('app must be launched')

  // Configure the folder picker dialog
  await configureNextOpenDialogForE2E(electronApp, { kind: 'openFolder', path: FOLDER_PATH })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-save-as"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-save-as"]').first().click()

  const modal = page.locator('[data-testid="save-options-modal"]')
  await expect(modal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="save-mode-folder"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(modal).not.toBeVisible({ timeout: 2000 })
  await page.waitForTimeout(1000)
})

Then(
  'the request file {string} should have an enumList param {string}',
  async ({}, requestName: string, paramName: string) => {
    const requestFile = findFileContaining(FOLDER_PATH, `name: ${requestName}`)
      ?? findFileContaining(FOLDER_PATH, `name: "${requestName}"`)
    expect(requestFile, `request file for "${requestName}" not found in ${FOLDER_PATH}`).toBeTruthy()

    if (!requestFile) return
    const content = readFileSync(requestFile, 'utf-8')
    expect(content).toContain(`key: ${paramName}`)
    expect(content).toContain('type: enumList')
    expect(content).toContain('enumDefinitionId:')
  }
)

When('I add tag {string} to the active environment folder tab', async ({}, tagName: string) => {
  if (!page) throw new Error('app must be launched')
  const tagsRoot = activeEnvFolderBookmarks(page)
  await expect(tagsRoot).toBeVisible({ timeout: 5000 })
  const addButton = tagsRoot.locator('[data-testid$="-bookmarks-add"]').first()
  await addButton.click()

  const input = page.locator('[data-testid$="-bookmarks-add-input-input"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.click()
  await input.fill(tagName)
  await page.keyboard.press('Enter')
  await expect(
    tagsRoot.locator('.ecui-bookmark-ribbon', { hasText: tagName }).first()
  ).toBeVisible({ timeout: 5000 })
})

Then(
  'the active environment folder tab renders tags {string} with distinct backgrounds',
  async ({}, expectedTags: string) => {
    if (!page) throw new Error('app must be launched')
    const names = expectedTags.split(',').map((s) => s.trim())

    const tagsRoot = activeEnvFolderBookmarks(page)
    // Each tag renders one `.ecui-bookmark-ribbon` inside the stack;
    // exclude the leading `[+]` add ribbon by filtering it out via the
    // `--add` modifier class.
    const tagLocator = tagsRoot.locator('.ecui-bookmark-ribbon:not(.ecui-bookmark-ribbon--add)')
    await expect(tagLocator).toHaveCount(names.length, { timeout: 5000 })

    const elements = await tagLocator.elementHandles()
    const renders = await Promise.all(
      elements.map(async (el) => {
        const label = (await el.innerText()).trim()
        // Color lives on the `::before` pseudo (clip-path silhouette
        // draws the signet body), so read its computed background.
        const bg = await el.evaluate((node) => getComputedStyle(node, '::before').backgroundColor)
        return { label, bg }
      })
    )

    for (const name of names) {
      const match = renders.find((r) => r.label === name)
      expect(match, `tag "${name}" not rendered in the active tab`).toBeTruthy()
    }

    const backgrounds = renders.map((r) => r.bg)
    expect(new Set(backgrounds).size).toBe(backgrounds.length)

    for (const bg of backgrounds) {
      expect(bg, 'tag background should resolve to a concrete color').not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/)
    }
  }
)

Then(
  'the environment folder file should have an enum definition with values {string}',
  async ({}, expectedValues: string) => {
    const envFolderFile = findFileContaining(FOLDER_PATH, 'folderType: environment')
    expect(envFolderFile, 'environment folder file not found').toBeTruthy()

    if (!envFolderFile) return
    const content = readFileSync(envFolderFile, 'utf-8')
    expect(content).toContain('enumDefinitions:')

    const expected = expectedValues.split(',')
    for (const val of expected) {
      expect(content).toContain(val.trim())
    }
  }
)

// ── Helpers ──

function findFileContaining(folderPath: string, needle: string): string | null {
  if (!existsSync(folderPath)) return null

  const walk = (dir: string): string | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = walk(fullPath)
        if (found) return found
      } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          if (content.includes(needle)) return fullPath
        } catch { /* skip */ }
      }
    }
    return null
  }

  return walk(folderPath)
}
