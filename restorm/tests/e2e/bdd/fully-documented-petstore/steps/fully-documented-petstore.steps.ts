import { createBdd } from 'playwright-bdd'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  test,
  expect,
  FULLY_DOCUMENTED_PETSTORE_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/fully-documented-petstore.fixture'
import type {
  ApiDocumentation
} from '../../../../../src/shared/types/apiDocumentation'
import { fillEveryDocumentationField } from '../../../helpers/fullyDocumentedPetstorePatch'

const PETSTORE_FIXTURE = resolve(__dirname, '../../../../unit/swagger-petstore.json')
const RESTORM_PATH = join(FULLY_DOCUMENTED_PETSTORE_TEMP_DIR, 'fully-documented-petstore.restorm')
/** Persistent copy preserved past the global teardown so a developer
 * can open the freshly-generated fixture in a running restorm
 * (e.g. via `pnpm dev:restorm:mcp`) without rerunning the whole e2e
 * round. The path is gitignored under `restorm/tmp/`. */
const PERSISTENT_OUTPUT_PATH = resolve(__dirname, '../../../../../tmp/fully-documented-petstore.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}

Given('a new single-file YAML collection seeded with the Petstore swagger', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: RESTORM_PATH })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)

  expect(existsSync(PETSTORE_FIXTURE), `Petstore fixture missing at ${PETSTORE_FIXTURE}`).toBe(true)

  await page.keyboard.press('Control+I')
  const importModal = page.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="source-input-input"]').fill(PETSTORE_FIXTURE)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 5000 })

  const importBtn = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importBtn).toBeVisible({ timeout: 5000 })
  await importBtn.click()
  await expect(importModal).not.toBeVisible({ timeout: 5000 })

  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+s')

  await expect
    .poll(async () => (await requirePage().title()).endsWith(' *'), {
      timeout: 10000,
      message: 'expected window to settle clean after import + save'
    })
    .toBe(false)

  expect(existsSync(RESTORM_PATH), `expected ${RESTORM_PATH} to be written by the save flow`).toBe(true)
})

interface CollectionsFile {
  collections: { apiDocumentation?: ApiDocumentation }[]
}

function loadCollectionsFile(path: string): CollectionsFile {
  const raw = readFileSync(path, 'utf-8')
  const parsed: unknown = parseYaml(raw)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { collections?: unknown }).collections)
  ) {
    throw new Error(`expected ${path} to expose a top-level collections array`)
  }
  return parsed as CollectionsFile
}

When('I patch the saved collection to fill every documentation field', async () => {
  const parsed = loadCollectionsFile(RESTORM_PATH)
  const folder = parsed.collections[0]
  expect(folder, 'parsed file should contain at least one collection').toBeTruthy()

  if (!folder.apiDocumentation) {
    throw new Error('imported collection has no apiDocumentation — Phase 1 transformer should have produced one')
  }

  fillEveryDocumentationField(folder.apiDocumentation)

  writeFileSync(RESTORM_PATH, stringifyYaml(parsed), 'utf-8')

  // Mirror to a stable, gitignored path that survives the global
  // teardown so a developer can open the produced fixture in a
  // running restorm without rerunning the e2e round.
  mkdirSync(dirname(PERSISTENT_OUTPUT_PATH), { recursive: true })
  copyFileSync(RESTORM_PATH, PERSISTENT_OUTPUT_PATH)
})

Then('the patched collection should round-trip through the loader', async () => {
  const parsed = loadCollectionsFile(RESTORM_PATH)
  const doc = parsed.collections[0]?.apiDocumentation
  expect(doc, 'patched file should still expose apiDocumentation').toBeTruthy()
  if (!doc) return

  expect(doc.api.contact?.email).toBeTruthy()
  expect(doc.api.license?.name).toBeTruthy()
  expect(doc.api.externalDocs?.url).toBeTruthy()
  expect(doc.api.termsOfService).toBeTruthy()

  for (const [groupName, group] of Object.entries(doc.groups)) {
    expect(group.description, `group ${groupName} should have a description`).toBeTruthy()
    expect(group.externalDocs?.url, `group ${groupName} should have externalDocs`).toBeTruthy()
  }

  for (const [modelName, model] of Object.entries(doc.models)) {
    expect(model.description, `model ${modelName} should have a description`).toBeTruthy()
    for (const prop of model.properties) {
      const where = `${modelName}.${prop.name}`
      expect(prop.description, `${where} should have a description`).toBeTruthy()
      expect(prop.example, `${where} should have an example`).not.toBeUndefined()
      expect(prop.constraints, `${where} should have constraints`).toBeTruthy()
    }
  }

  for (let i = 0; i < doc.operations.length; i++) {
    const op = doc.operations[i]
    const where = `operation #${i}`
    expect(op.description, `${where} should have a description`).toBeTruthy()
    expect(op.externalDocs?.url, `${where} should have externalDocs`).toBeTruthy()
    expect(op.security, `${where} should have security`).toBeTruthy()
    expect(op.consumes, `${where} should have consumes`).toBeTruthy()
    expect(op.produces, `${where} should have produces`).toBeTruthy()
    if (op.parameters) {
      for (const param of op.parameters) {
        const paramWhere = `param ${op.match.urlPattern}::${param.name}`
        expect(param.example, `${paramWhere} should have an example`).not.toBeUndefined()
        expect(param.constraints, `${paramWhere} should have constraints`).toBeTruthy()
      }
    }
    if (op.responses) {
      for (const [code, resp] of Object.entries(op.responses)) {
        const respWhere = `response ${op.match.urlPattern}::${code}`
        expect(resp.headers, `${respWhere} should have headers`).toBeTruthy()
        expect(resp.examples, `${respWhere} should have examples`).toBeTruthy()
      }
    }
  }
})

// Patcher helpers live in `tests/e2e/helpers/fullyDocumentedPetstorePatch.ts`
// so the visual `exhaustive-doc-viewer` suite can reuse the exact
// same data-shaping logic.
