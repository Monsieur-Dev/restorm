/**
 * API Blueprint → ApiDocumentation transformer.
 *
 * The source is not the raw `.apib` text but the API Elements (refract)
 * tree `drafter.js` produces from it — every node is a `{ element, meta?,
 * attributes?, content }` wrapper, including primitives (a bare string is
 * `{ element: 'string', content: 'foo' }`). `RefractElement` below models
 * just the shapes this transformer touches; `ApiBlueprintImportService`
 * walks the same tree to build the imported folder + requests.
 */

import type {
  ApiDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- Refract (API Elements) primitives ----------

export interface RefractElement {
  element: string
  meta?: {
    classes?: RefractElement
    title?: RefractElement
    description?: RefractElement
    id?: RefractElement
  }
  /** Named rather than a generic index signature — API Blueprint only ever
   * populates this fixed set of attribute keys across the element kinds
   * this transformer + `ApiBlueprintImportService` walk. */
  attributes?: {
    href?: RefractElement
    hrefVariables?: RefractElement
    method?: RefractElement
    headers?: RefractElement
    statusCode?: RefractElement
    typeAttributes?: RefractElement
    metadata?: RefractElement
  }
  content?: unknown
}

// These are also used by `ApiBlueprintImportService` to walk the exact same
// refract tree when building the imported folder + requests — exported here
// rather than duplicated.

/** Primitive elements (`string` / `number` / `boolean`) carry their raw JS value on `content`. */
export function primitiveContent(el: RefractElement | undefined): string | number | boolean | undefined {
  if (el?.content === undefined) return undefined
  return typeof el.content === 'string' || typeof el.content === 'number' || typeof el.content === 'boolean'
    ? el.content
    : undefined
}

export function stringContent(el: RefractElement | undefined): string | undefined {
  const value = primitiveContent(el)
  return typeof value === 'string' ? value : undefined
}

/** `array` elements carry their items as an element array on `content`. */
export function arrayContent(el: RefractElement | undefined): RefractElement[] {
  return el?.element === 'array' && Array.isArray(el.content) ? (el.content as RefractElement[]) : []
}

/** Generic `.content` array reader for container elements (category, resource, transition, ...). */
export function contentArray(el: RefractElement): RefractElement[] {
  return Array.isArray(el.content) ? (el.content as RefractElement[]) : []
}

export function classesOf(el: RefractElement): string[] {
  return arrayContent(el.meta?.classes).map(stringContent).filter((c): c is string => c !== undefined)
}

export function hasClass(el: RefractElement, className: string): boolean {
  return classesOf(el).includes(className)
}

export function titleOf(el: RefractElement): string | undefined {
  return stringContent(el.meta?.title)
}

export function memberKeyValue(member: RefractElement): { key?: string; value?: RefractElement } {
  const pair = member.content as { key?: RefractElement; value?: RefractElement } | undefined
  const key = stringContent(pair?.key)
  const value = pair?.value
  return { ...(key !== undefined && { key }), ...(value !== undefined && { value }) }
}

/** `metadata` array member lookup (e.g. the top-level `HOST` / `FORMAT` entries). */
export function metadataValue(apiCategory: RefractElement, key: string): string | undefined {
  const members = arrayContent(apiCategory.attributes?.metadata)
  for (const member of members) {
    const { key: memberKey, value } = memberKeyValue(member)
    if (memberKey === key) return stringContent(value)
  }
  return undefined
}

/** First `asset` child of the given class (e.g. `messageBody`) — its raw text content. */
export function collectAssetText(container: RefractElement, className: string): string | undefined {
  for (const el of contentArray(container)) {
    if (el.element === 'asset' && hasClass(el, className) && typeof el.content === 'string') return el.content
  }
  return undefined
}

// ---------- Parameters (hrefVariables) ----------

function apiBlueprintTypeToDocType(typeName: string | undefined): string {
  return typeName ?? 'string'
}

function hrefVariablesToParameters(resource: RefractElement): ParameterDocumentation[] {
  const members = arrayContent(resource.attributes?.hrefVariables)
  return members.map((member) => {
    const { key, value } = memberKeyValue(member)
    const required = arrayContent(member.attributes?.typeAttributes).some((a) => stringContent(a) === 'required')
    const param: ParameterDocumentation = {
      name: key ?? '',
      location: 'path',
      type: apiBlueprintTypeToDocType(titleOf(member) ?? value?.element),
      required
    }
    const description = stringContent(member.meta?.description)
    if (description !== undefined) param.description = description
    const defaultValue = stringContent(value)
    if (defaultValue !== undefined) param.defaultValue = defaultValue
    return param
  })
}

// ---------- Data Structures → models ----------

/** Named object/enum definitions declared under the `# Data Structures` section. */
function dataStructureCategoryToModels(category: RefractElement): Record<string, ModelDocumentation> {
  const models: Record<string, ModelDocumentation> = {}
  for (const dataStructure of contentArray(category)) {
    if (dataStructure.element !== 'dataStructure') continue
    const def = dataStructure.content as RefractElement | undefined
    const name = stringContent(def?.meta?.id)
    if (!def || !name) continue
    models[name] = namedStructureToModel(name, def)
  }
  return models
}

function namedStructureToModel(name: string, def: RefractElement): ModelDocumentation {
  if (def.element === 'enum') {
    // `enum` extends `array` in the refract spec — its `content` is a bare
    // array of value elements, not itself wrapped in an `array` element.
    const values = contentArray(def)
      .map(primitiveContent)
      .filter((v): v is string | number | boolean => v !== undefined)
    return { name, properties: [], enumValues: values }
  }

  const members = contentArray(def).filter((m) => m.element === 'member')
  return { name, properties: members.map(memberToProperty) }
}

function memberToProperty(member: RefractElement): PropertyDocumentation {
  const { key, value } = memberKeyValue(member)
  const required = arrayContent(member.attributes?.typeAttributes).some((a) => stringContent(a) === 'required')

  let type = 'string'
  let targetModelRef: string | undefined
  let isArrayOfRef = false

  if (value) {
    if (value.element === 'array') {
      type = 'array'
      const item = arrayContent(value)[0]
      if (item && item.content === undefined) {
        // A bare `{ element: 'Choice' }` item — the array holds refs to a named model.
        targetModelRef = item.element
        isArrayOfRef = true
      }
    } else if (value.content === undefined && value.element !== 'string' && value.element !== 'number' && value.element !== 'boolean') {
      // A bare named-type reference (`+ author (User)`).
      targetModelRef = value.element
      type = value.element
    } else {
      type = value.element
    }
  }

  const prop: PropertyDocumentation = { name: key ?? '', type, required }
  const description = stringContent(member.meta?.description)
  if (description !== undefined) prop.description = description
  if (targetModelRef !== undefined) prop.targetModelRef = targetModelRef
  if (isArrayOfRef) prop.isArrayOfRef = true
  return prop
}

// ---------- Operations ----------

interface WalkContext {
  groupLabel: string | undefined
  operations: OperationDocumentation[]
}

function httpTransactionToOperation(
  resourceHref: string,
  resourceParameters: ParameterDocumentation[],
  transitionTitle: string | undefined,
  httpTransaction: RefractElement,
  ctx: WalkContext
): void {
  const [request, response] = contentArray(httpTransaction)
  if (request?.element !== 'httpRequest') return

  const method = stringContent(request.attributes?.method)
  if (!method) return

  const doc: OperationDocumentation = {
    match: { urlPattern: resourceHref, method }
  }
  if (ctx.groupLabel !== undefined) doc.group = ctx.groupLabel
  if (transitionTitle !== undefined) doc.summary = transitionTitle
  if (resourceParameters.length > 0) doc.parameters = resourceParameters

  const requestBody = collectAssetText(request, 'messageBody')
  if (response?.element === 'httpResponse') {
    const statusCode = stringContent(response.attributes?.statusCode) ?? 'default'
    const responseBody = collectAssetText(response, 'messageBody')
    doc.responses = {
      [statusCode]: responseBody !== undefined ? { schema: responseBody } : {}
    }
  }
  if (requestBody !== undefined) {
    doc.extra = { requestBodyExample: requestBody }
  }

  ctx.operations.push(doc)
}

function resourceToOperations(resource: RefractElement, ctx: WalkContext): void {
  const href = stringContent(resource.attributes?.href) ?? '/'
  const parameters = hrefVariablesToParameters(resource)

  for (const transition of contentArray(resource)) {
    if (transition.element !== 'transition') continue
    const transitionTitle = titleOf(transition)
    for (const httpTransaction of contentArray(transition)) {
      if (httpTransaction.element !== 'httpTransaction') continue
      httpTransactionToOperation(href, parameters, transitionTitle, httpTransaction, ctx)
    }
  }
}

// ---------- Entry point ----------

export interface ApiBlueprintTransformOptions {
  sourceUrl?: string
}

export function apiBlueprintToApiDocumentation(
  apiCategory: RefractElement,
  options: ApiBlueprintTransformOptions = {}
): ApiDocumentation {
  const title = titleOf(apiCategory) ?? 'API Blueprint'
  const description = contentArray(apiCategory)
    .find((el) => el.element === 'copy')
    ?.content
  const host = metadataValue(apiCategory, 'HOST')

  let models: Record<string, ModelDocumentation> = {}
  const operations: OperationDocumentation[] = []

  for (const child of contentArray(apiCategory)) {
    if (child.element === 'category' && hasClass(child, 'resourceGroup')) {
      const groupLabel = titleOf(child)
      const ctx: WalkContext = { groupLabel, operations }
      for (const resource of contentArray(child)) {
        if (resource.element === 'resource') resourceToOperations(resource, ctx)
      }
    } else if (child.element === 'resource') {
      // Ungrouped resource declared directly under the API category.
      resourceToOperations(child, { groupLabel: undefined, operations })
    } else if (child.element === 'category' && hasClass(child, 'dataStructures')) {
      models = { ...models, ...dataStructureCategoryToModels(child) }
    }
  }

  const groups: ApiDocumentation['groups'] = {}
  for (const op of operations) {
    if (op.group !== undefined && !(op.group in groups)) groups[op.group] = { name: op.group }
  }

  const result: ApiDocumentation = {
    sourceType: 'api-blueprint',
    api: { title },
    models,
    groups,
    operations
  }
  if (typeof description === 'string') result.api.description = description
  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl
  if (host !== undefined) result.server = { host }

  return result
}
