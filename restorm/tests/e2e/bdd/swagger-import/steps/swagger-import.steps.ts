import { createBdd } from 'playwright-bdd'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, SWAGGER_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E } from '../../fixtures/swagger-import.fixture'

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

  // Close the auto-opened env folder tab
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
