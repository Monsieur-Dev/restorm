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
  ApiDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation,
  ResponseDocumentation,
  SchemaConstraints
} from '../../../../../src/shared/types/apiDocumentation'

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

  const saveOptions = page.locator('[data-testid="save-options-modal"]')
  await expect(saveOptions).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="save-mode-file"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(saveOptions).not.toBeVisible({ timeout: 2000 })
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

// ──────────────────────────────────────────────────────────────────────
// Helpers — content-agnostic fillers for every documentation field
// ──────────────────────────────────────────────────────────────────────

function fillEveryDocumentationField(doc: ApiDocumentation): void {
  fillApiInfo(doc)
  fillGroups(doc)
  fillModels(doc)
  fillOperations(doc)
}

/** True when the value is missing or an empty string — those are the
 * cases the patcher should fill, while preserving any meaningful value
 * the importer already wrote. */
function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function fillApiInfo(doc: ApiDocumentation): void {
  if (isMissing(doc.api.description)) {
    doc.api.description = `${doc.api.title} — extended documentation generated by the fully-documented-petstore fixture builder.`
  }
  doc.api.contact ??= {
    name: 'Petstore Support',
    email: 'support@petstore.example',
    url: 'https://petstore.example/support'
  }
  doc.api.license ??= {
    name: 'Apache 2.0',
    url: 'http://www.apache.org/licenses/LICENSE-2.0.html'
  }
  if (isMissing(doc.api.termsOfService)) {
    doc.api.termsOfService = 'https://petstore.example/terms'
  }
  doc.api.externalDocs ??= {
    description: 'Petstore developer portal',
    url: 'https://petstore.example/docs'
  }
}

function fillGroups(doc: ApiDocumentation): void {
  for (const [name, g] of Object.entries(doc.groups)) {
    if (isMissing(g.description)) {
      g.description = `Operations related to the **${name}** resource. Covers CRUD, listing, and lifecycle endpoints.`
    }
    g.externalDocs ??= {
      description: `${name} reference`,
      url: `https://petstore.example/docs/${encodeURIComponent(name)}`
    }
  }
}

function fillModels(doc: ApiDocumentation): void {
  const entries = Object.entries(doc.models)
  const names = entries.map(([name]) => name)
  entries.forEach(([, m], idx) => {
    if (isMissing(m.description)) {
      m.description = `**${m.name}** — ${m.name.toLowerCase()} resource representation.`
    }
    if (idx === 0) m.deprecated = true
    if (idx === entries.length - 1) m.removed = true
    m.properties.forEach((prop: PropertyDocumentation, pIdx: number) => {
      fillProperty(prop, m, pIdx, names)
    })
  })
}

function fillProperty(
  prop: PropertyDocumentation,
  model: ModelDocumentation,
  pIdx: number,
  modelNames: string[]
): void {
  if (isMissing(prop.description)) {
    prop.description = `The \`${prop.name}\` ${categoriseType(prop.type)} field of ${model.name}.`
  }
  if (prop.example === undefined) prop.example = synthesiseExample(prop.type, prop.name)
  if (prop.enumValues === undefined && prop.type === 'string' && pIdx === 1) {
    prop.enumValues = ['available', 'pending', 'sold']
  }
  prop.constraints ??= synthesiseConstraints(prop.type)
  if (prop.nullable === undefined && pIdx % 3 === 0) prop.nullable = true
  if (prop.readOnly === undefined && pIdx === 0) prop.readOnly = true
  if (prop.deprecated === undefined && pIdx % 4 === 0 && pIdx !== 0) prop.deprecated = true
  if (prop.targetModelRef === undefined && pIdx === model.properties.length - 1 && modelNames.length > 1) {
    const cousin = modelNames.find((n) => n !== model.name)
    if (cousin) {
      prop.targetModelRef = cousin
      prop.isArrayOfRef = /array/i.test(prop.type)
    }
  }
}

function fillOperations(doc: ApiDocumentation): void {
  doc.operations.forEach((op: OperationDocumentation, oIdx: number) => {
    if (isMissing(op.description)) {
      op.description = !isMissing(op.summary)
        ? `${op.summary} — extended documentation generated by the fixture builder.`
        : `${op.match.method ?? 'HTTP'} ${op.match.urlPattern}`
    }
    if (isMissing(op.summary)) {
      op.summary = `${op.match.method ?? 'HTTP'} ${op.match.urlPattern}`
    }
    op.externalDocs ??= {
      description: 'Operation reference',
      url: `https://petstore.example/docs/op/${op.operationId ?? oIdx}`
    }
    if (op.deprecated === undefined && oIdx % 5 === 0 && oIdx !== 0) op.deprecated = true
    op.security ??= [{ petstore_auth: ['read:pets', 'write:pets'] }, { api_key: [] }]
    op.consumes ??= ['application/json', 'application/xml']
    op.produces ??= ['application/json', 'application/xml']
    op.extra ??= {
      'x-rate-limit': '100/min',
      'x-deprecated-since': oIdx % 5 === 0 ? '2024-06-01' : undefined,
      'x-internal-only': false,
      'x-codegen-tags': ['petstore', 'experimental']
    }
    // First operation gets non-HTTP discriminants injected so the
    // SOAP / GraphQL / WS row of the route header gets exercised
    // in the visual fixture without needing a separate non-HTTP
    // import.
    if (oIdx === 0) {
      op.match.serviceName ??= 'PetService'
      op.match.operationName ??= 'getPetByIdRpc'
      op.match.soapAction ??= 'http://petstore/PetService/getPetById'
    }
    if (oIdx === 1) {
      op.match.event ??= 'pet.updated'
      op.match.direction ??= 'publish'
    }
    op.parameters?.forEach((param: ParameterDocumentation, pIdx: number) => {
      fillParameter(param, pIdx)
    })
    if (op.responses) {
      for (const [code, resp] of Object.entries(op.responses)) {
        fillResponse(resp, code)
      }
    }
  })
}

function fillParameter(param: ParameterDocumentation, pIdx: number): void {
  if (isMissing(param.description)) {
    param.description = `The \`${param.name}\` ${categoriseType(param.type)} ${param.location} parameter.`
  }
  if (param.example === undefined) param.example = synthesiseExample(param.type, param.name)
  if (param.examples === undefined && pIdx === 0) {
    param.examples = {
      default: synthesiseExample(param.type, param.name),
      alternative: synthesiseExample(param.type, `${param.name}-alt`)
    }
  }
  if (param.enumValues === undefined && param.type === 'string' && pIdx === 1) {
    param.enumValues = ['available', 'pending', 'sold']
  }
  if (param.collectionFormat === undefined && /array/i.test(param.type)) {
    param.collectionFormat = 'multi'
  }
  if (param.allowEmptyValue === undefined && param.location === 'query') {
    param.allowEmptyValue = false
  }
  param.constraints ??= synthesiseConstraints(param.type)
}

function fillResponse(resp: ResponseDocumentation, code: string): void {
  if (isMissing(resp.description)) {
    resp.description = `Response with status \`${code}\`.`
  }
  resp.headers ??= {
    'X-Rate-Limit': { type: 'integer', description: 'Calls remaining in the current window.' },
    'X-Request-Id': { type: 'string', description: 'Server-issued request identifier.' }
  }
  resp.examples ??= {
    'application/json': { status: code, message: 'Synthetic example payload.' },
    'application/xml': `<response code="${code}"><message>Synthetic example payload.</message></response>`
  }
}

function categoriseType(type: string): string {
  if (/array/i.test(type)) return 'array'
  if (/integer|number|long|float|double/i.test(type)) return 'numeric'
  if (/bool/i.test(type)) return 'boolean'
  if (/date/i.test(type)) return 'date'
  return type || 'string'
}

function synthesiseExample(type: string, hint: string): unknown {
  if (/array/i.test(type)) return [synthesiseExample(type.replace(/array<?/i, '').replace(/>?$/, ''), hint)]
  if (/integer|long/i.test(type)) return /id$/i.test(hint) ? 42 : 7
  if (/number|float|double/i.test(type)) return 19.99
  if (/bool/i.test(type)) return true
  if (/date-time/i.test(type)) return '2026-01-15T09:30:00Z'
  if (/date/i.test(type)) return '2026-01-15'
  return `${hint}-example`
}

function synthesiseConstraints(type: string): SchemaConstraints {
  if (/integer|long|number|float|double/i.test(type)) {
    return { minimum: 0, maximum: 1000, multipleOf: 1 }
  }
  if (/array/i.test(type)) {
    return { uniqueItems: true }
  }
  return { minLength: 1, maxLength: 256, pattern: '^[\\w\\s\\-\\.]+$' }
}
