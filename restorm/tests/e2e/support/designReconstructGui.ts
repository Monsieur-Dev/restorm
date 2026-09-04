import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type {
  ApiDesign, DesignModel, DesignEnum, DesignProperty, DesignRoute, DesignRouteGroup
} from '../../../src/shared/types/apiDesign'
import { openDesignSection } from './designNav'
import {
  createBlankDesign, setDesignIdentity, renameDesignNode, setServingProtocols,
  addModel, renameModel, addProperty, openModel, openModelTab, openRouteTab,
  fillInput, fillVariableInput, pickSelect, pickSelectExact, toggleTo, editLabel
} from './designGuiDriver'

/**
 * Reconstruct an API design ENTIRELY through the GUI (clicks + typed input),
 * mirroring how a user builds it. The routes are produced by the same
 * Generate CRUD / Generate Search buttons the golden was built with, so the
 * click path reproduces the golden's generated surface faithfully.
 *
 * Build order mirrors the MCP reconstruction (references resolve by NAME in the
 * UI, so targets must exist first): identity → enums → model shells → fill each
 * model (properties, identifier, inheritance, examples) → routes (generate per
 * model + hand-add the non-CRUD relation routes).
 */

const STRATEGY_LABEL: Record<string, string> = { uuid: 'UUID', autoIncrement: 'Auto-increment', ulid: 'ULID' }

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((it) => [it.id, it]))
}

/** Render a JSON-ish value for a text field: scalars as-is, objects as JSON. */
function toInputText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export async function reconstructDesignGui(p: Page, golden: ApiDesign): Promise<string> {
  const models = byId(golden.models)
  const enums = byId(golden.enums)
  const modelName = (id: string): string => models.get(id)?.doc.name ?? id
  const enumName = (id: string): string => enums.get(id)?.doc.name ?? id

  const designId = await createBlankDesign(p)
  await setDesignIdentity(p, {
    title: golden.info.title,
    version: golden.info.version,
    description: golden.info.description,
    basePath: golden.server?.basePath
  })
  await renameDesignNode(p, designId, golden.name)
  if (golden.serving?.protocols !== undefined) await setServingProtocols(p, designId, golden.serving.protocols)

  await buildEnums(p, designId, golden.enums)

  // Model shells first (name + description) so references and inheritance resolve.
  await openDesignSection(p, designId, 'models')
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
  for (const m of golden.models) await buildModelShell(p, designId, m)
  for (const m of golden.models) await fillModel(p, designId, m, modelName, enumName)

  await buildRoutes(p, designId, golden, modelName)
  return designId
}

// ── Enums ───────────────────────────────────────────────────────────────

async function buildEnums(p: Page, designId: string, enumsList: readonly DesignEnum[]): Promise<void> {
  if (enumsList.length === 0) return
  await openDesignSection(p, designId, 'enums')
  await expect(p.locator('[data-testid="design-enums-section"]')).toBeVisible({ timeout: 5000 })
  for (const e of enumsList) {
    await p.locator('[data-testid="design-enums-add-list-button"]').click()
    const rename = p.locator('.list-view-rename-input:visible').first()
    await expect(rename).toBeVisible({ timeout: 5000 })
    await rename.fill(e.doc.name)
    await rename.press('Enter')
    await p.waitForTimeout(250)
    if (e.doc.description !== undefined && e.doc.description !== '') {
      await fillInput(p, 'design-enum-description', e.doc.description)
    }
    for (const value of e.doc.enumValues ?? []) {
      await p.locator('[data-testid="design-enums-add-entry-button"]').click()
      await p.waitForTimeout(150)
      const keyInput = p.locator('[data-testid^="design-enums-entries-table-row-"][data-testid$="-key-input"]').last()
      const valueInput = p.locator('[data-testid^="design-enums-entries-table-row-"][data-testid$="-value-input"]').last()
      await expect(keyInput).toBeVisible({ timeout: 5000 })
      await keyInput.fill(String(value))
      await keyInput.blur()
      if (await valueInput.count() > 0) {
        await valueInput.fill(String(value))
        await valueInput.blur()
      }
      await p.waitForTimeout(150)
    }
  }
}

// ── Models ──────────────────────────────────────────────────────────────

async function buildModelShell(p: Page, designId: string, m: DesignModel): Promise<void> {
  await openDesignSection(p, designId, 'models')
  await addModel(p, designId)
  await renameModel(p, m.doc.name)
  if (m.doc.description !== undefined && m.doc.description !== '') {
    await fillInput(p, 'design-model-description', m.doc.description)
  }
}

async function fillModel(
  p: Page, designId: string, m: DesignModel,
  modelName: (id: string) => string, enumName: (id: string) => string
): Promise<void> {
  await openDesignSection(p, designId, 'models')
  await openModel(p, m.doc.name)
  await openModelTab(p, 'schema') // the detail Tabs retains the previous model's active tab

  // Own properties (inherited ones aren't in m.properties). Capture each id for examples.
  const propId = new Map<string, string>()
  for (const prop of m.properties) {
    const id = await addProperty(p, prop.doc.name)
    propId.set(prop.doc.name, id)
    await setPropertyFields(p, prop, modelName, enumName)
  }

  // Settings tab: inheritance, identifier, timestamps, soft-delete, volumetry.
  await openModelTab(p, 'settings')
  if (m.design?.inheritsFrom !== undefined) {
    await pickSelectExact(p, 'design-model-inherits', modelName(m.design.inheritsFrom))
  }
  if (m.design?.identifier !== undefined) {
    const idPropName = m.properties.find((pr) => pr.id === m.design?.identifier?.propertyId)?.doc.name
    if (idPropName !== undefined) {
      await pickSelectExact(p, 'design-model-identifier-property', idPropName)
      const label = STRATEGY_LABEL[m.design.identifier.strategy]
      if (label !== undefined) await pickSelectExact(p, 'design-model-identifier-strategy', label)
    }
  }
  if (m.design?.timestamps === true) await toggleTo(p, 'design-model-timestamps', true)
  if (m.design?.softDelete === true) await toggleTo(p, 'design-model-soft-delete', true)

  // Examples.
  const examples = m.examples ?? []
  if (examples.length > 0) {
    await openModelTab(p, 'examples')
    for (const ex of examples) {
      await p.locator('[data-testid="design-example-add"]').click()
      await p.waitForTimeout(200)
      await fillInput(p, 'design-example-name', ex.name)
      for (const [pid, val] of Object.entries(ex.values)) {
        // Golden example values are keyed by property id; map to the id we minted.
        const name = m.properties.find((pr) => pr.id === pid)?.doc.name
        const localId = name !== undefined ? propId.get(name) : undefined
        if (localId === undefined) continue
        await fillInput(p, `design-example-value-${localId}`, String(val))
      }
    }
  }
}

async function setPropertyFields(
  p: Page, prop: DesignProperty,
  modelName: (id: string) => string, enumName: (id: string) => string
): Promise<void> {
  const doc = prop.doc
  const design = prop.design
  const ref = design?.reference

  // Type / reference. Picking a model/enum in the type dropdown establishes the
  // reference; an array-of-ref is type=array + a model/enum element choice.
  if (doc.isArrayOfRef === true && ref !== undefined) {
    await pickSelectExact(p, 'design-property-type', 'array')
    const label = ref.target === 'enum' ? `${enumName(ref.refId)} (enum)` : `${modelName(ref.refId)} (model)`
    await pickSelect(p, 'design-property-element-type', label)
  } else if (ref !== undefined) {
    const label = ref.target === 'enum' ? `${enumName(ref.refId)} (enum)` : `${modelName(ref.refId)} (model)`
    await pickSelect(p, 'design-property-type', label)
    if (ref.target === 'model' && ref.onDelete !== undefined) {
      const onDeleteLabel: Record<string, string> = {
        restrict: 'Restrict (forbid while used)', cascade: 'Cascade delete', setNull: 'Set to null'
      }
      const l = onDeleteLabel[ref.onDelete]
      if (l !== undefined) await pickSelect(p, 'design-property-ondelete', l)
    }
  } else {
    await pickSelectExact(p, 'design-property-type', doc.type)
    if (doc.type === 'array' && design?.arrayItems?.type !== undefined) {
      await pickSelectExact(p, 'design-property-element-type', design.arrayItems.type)
    }
  }

  if (doc.format !== undefined && doc.format !== '') {
    await pickSelect(p, 'design-property-format', doc.format)
  }

  // Constraints (string lengths / number bounds / pattern).
  const c = doc.constraints
  if (c !== undefined) {
    if (c.minLength !== undefined) await fillInput(p, 'design-property-min-length', String(c.minLength))
    if (c.maxLength !== undefined) await fillInput(p, 'design-property-max-length', String(c.maxLength))
    if (c.minimum !== undefined) await fillInput(p, 'design-property-minimum', String(c.minimum))
    if (c.maximum !== undefined) await fillInput(p, 'design-property-maximum', String(c.maximum))
    if (c.pattern !== undefined) await fillInput(p, 'design-property-pattern', c.pattern)
  }

  if (doc.description !== undefined && doc.description !== '') await fillInput(p, 'design-property-description', doc.description)
  if (doc.example !== undefined) await fillInput(p, 'design-property-example', toInputText(doc.example))
  if (design?.defaultValue !== undefined) await fillInput(p, 'design-property-default', toInputText(design.defaultValue))

  // Flags (only toggle the ones the golden sets true).
  const flags: [boolean | undefined, string][] = [
    [doc.required, 'required'], [doc.nullable, 'nullable'], [doc.readOnly, 'readOnly'], [doc.deprecated, 'deprecated'],
    [design?.unique, 'unique'], [design?.searchable, 'searchable'], [design?.immutable, 'immutable'], [design?.writeOnly, 'writeOnly'],
    [prop.intents?.pii, 'pii']
  ]
  for (const [on, key] of flags) {
    if (on === true) await toggleTo(p, `design-flag-${key}`, true)
  }
}

// ── Routes (via generators + hand-added relation routes) ─────────────────

const STANDARD_PATHS = new Set(['/', '/{{id}}'])

async function buildRoutes(
  p: Page, designId: string, golden: ApiDesign, modelName: (id: string) => string
): Promise<void> {
  // Pass 1 — generate CRUD (+ search) per model. Search must run before any
  // relation route exists: generateSearch attaches its param links to whatever
  // route returns the model's paginated list, and a relation route returning the
  // same model (e.g. the client's offers) would wrongly absorb them otherwise.
  for (const group of golden.routeGroups) {
    const listRoute = group.routes.find((r) => r.doc.match.method === 'GET' && r.doc.match.urlPattern === '/')
    const listModelId = listRoute !== undefined ? listResponseModelId(listRoute) : undefined
    if (listModelId === undefined) continue
    const gModelName = modelName(listModelId)
    const authWrites = group.routes.some((r) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.doc.match.method) && r.design?.authOverride === 'bearer')
    const hasSearch = listRoute?.design?.paramLinks !== undefined && Object.keys(listRoute.design.paramLinks).length > 0
    await generateCrud(p, designId, gModelName, authWrites)
    if (hasSearch) await generateSearch(p, designId, gModelName)
  }

  // Pass 2 — hand-add the non-CRUD relation routes (e.g. GET /{{id}}/properties).
  for (const group of golden.routeGroups) {
    const relationRoutes = group.routes.filter((r) => !STANDARD_PATHS.has(r.doc.match.urlPattern))
    for (const r of relationRoutes) await addRelationRoute(p, designId, group, r, modelName)
  }
}

function listResponseModelId(route: DesignRoute): string | undefined {
  const responses = route.design?.responses ?? {}
  for (const resp of Object.values(responses)) {
    if (resp.list === true && resp.modelId !== undefined) return resp.modelId
  }
  return Object.values(responses).find((r) => r.modelId !== undefined)?.modelId
}

async function generateCrud(p: Page, designId: string, model: string, authWrites: boolean): Promise<void> {
  await openDesignSection(p, designId, 'models')
  await openModel(p, model)
  await openModelTab(p, 'settings')
  await p.locator('[data-testid="design-model-generate-crud"]').click()
  await expect(p.locator('[data-testid="design-crud-modal"]')).toBeVisible({ timeout: 5000 })
  if (authWrites) await toggleTo(p, 'design-crud-auth-writes', true)
  await p.locator('[data-testid="design-crud-confirm"]').click()
  await expect(p.locator('[data-testid="design-crud-modal"]')).toHaveCount(0, { timeout: 5000 })
  await p.waitForTimeout(300)
}

async function generateSearch(p: Page, designId: string, model: string): Promise<void> {
  await openDesignSection(p, designId, 'models')
  await openModel(p, model)
  await openModelTab(p, 'settings')
  await p.locator('[data-testid="design-model-generate-search"]').click()
  await p.waitForTimeout(400)
}

async function selectGroup(p: Page, groupName: string): Promise<void> {
  await p.locator('[data-testid="design-routes-listview"] .list-view-row')
    .filter({ has: p.getByText(groupName, { exact: true }) }).first().click()
  await expect(p.locator('[data-testid="design-group-add-route"]')).toBeVisible({ timeout: 5000 })
}

async function addRelationRoute(
  p: Page, designId: string, group: DesignRouteGroup, r: DesignRoute, modelName: (id: string) => string
): Promise<void> {
  await openDesignSection(p, designId, 'routes')
  await selectGroup(p, group.doc.name)
  await p.locator('[data-testid="design-group-add-route"]').click()
  await expect(p.locator('[data-testid="design-route-tabs"]')).toBeVisible({ timeout: 5000 })

  // Definition tab: method, path, summary, description.
  if (r.doc.match.method !== 'GET') await pickSelectExact(p, 'design-route-method', r.doc.match.method)
  await fillVariableInput(p, 'design-route-path', r.doc.match.urlPattern)
  if (r.doc.summary !== undefined) await editLabel(p, 'design-route-summary-label', r.doc.summary)
  if (r.doc.description !== undefined) await fillInput(p, 'design-route-description', r.doc.description)

  // Responses tab: set up each response (default route ships a 200).
  await openRouteTab(p, 'responses')
  const docResponses = r.doc.responses ?? {}
  const metaResponses = r.design?.responses ?? {}
  for (const code of new Set([...Object.keys(docResponses), ...Object.keys(metaResponses)])) {
    await ensureResponseCode(p, code)
    const meta = metaResponses[code]
    if (meta?.modelId !== undefined) {
      await pickSelect(p, `design-response-model-${code}`, modelName(meta.modelId))
      if (meta.list === true) await toggleTo(p, `design-response-list-${code}`, true)
      if (meta.paginated === true) await toggleTo(p, `design-response-paginated-${code}`, true)
    }
    const desc = docResponses[code]?.description
    if (desc !== undefined) await fillInput(p, `design-response-description-${code}`, desc)
  }

  // Settings tab: idempotent.
  await openRouteTab(p, 'settings')
  if (r.design?.idempotent === true) await toggleTo(p, 'design-route-idempotent', true)
}

async function ensureResponseCode(p: Page, code: string): Promise<void> {
  const header = p.locator(`[data-testid="design-response-header-${code}"]`)
  if (await header.count() === 0) {
    await fillInput(p, 'design-response-new-code', code)
    await p.locator('[data-testid="design-response-add"]').click()
    await p.waitForTimeout(250)
  }
  // Expand the row so its inner controls render.
  const h = p.locator(`[data-testid="design-response-header-${code}"]`)
  await expect(h).toBeVisible({ timeout: 5000 })
  if ((await h.getAttribute('aria-expanded')) === 'false') {
    await h.click()
    await p.waitForTimeout(200)
  }
}
