/**
 * The versioned JSON context a code-generation template receives.
 *
 * This is the PUBLIC CONTRACT between Restorm and template authors
 * (official and community): a flattened, template-ergonomic projection
 * of the design — cross-references travel by NAME (a Jinja template
 * addresses `property.enum`, never an internal id), paths come both
 * group-relative and fully composed, and every design intention that a
 * server template can honour (auth, cache, pagination, volumetry, PII)
 * is carried. The shape is documented by the JSON Schema published in
 * `docs/contributing/design-codegen-context.schema.json` and versioned
 * by {@link CODEGEN_CONTEXT_VERSION}: a template's manifest declares
 * the versions it supports, and an incompatibility refuses generation
 * BEFORE anything renders.
 */

import type {
  ApiDesign,
  DesignModel,
  DesignRoute,
  DesignRouteGroup
} from '../types/apiDesign'
import { composeRoutePath, groupChainBasePath } from './apiDesignDoc'
import { routePathParams } from './designRoutes'
import { effectiveAuth } from './designServing'

/** Bump ONLY with a documented migration note — template manifests
 * pin the versions they understand. */
export const CODEGEN_CONTEXT_VERSION = 1

export interface CodegenContext {
  contextVersion: number
  design: {
    name: string
    version?: string
    description?: string
    basePath?: string
    defaultAuth: string
  }
  enums: CodegenEnum[]
  models: CodegenModel[]
  groups: CodegenGroup[]
}

export interface CodegenEnum {
  name: string
  description?: string
  values: (string | number)[]
}

export interface CodegenProperty {
  name: string
  /** Scalar label (`string` / `integer` / `number` / `boolean` / `array` /
   * `map` / `any`) — references carry the label of what they point at. */
  type: string
  format?: string
  required: boolean
  readOnly?: boolean
  writeOnly?: boolean
  nullable?: boolean
  description?: string
  example?: unknown
  default?: unknown
  /** Referenced enum NAME. */
  enum?: string
  /** Referenced model NAME (+ the declared delete behaviour). */
  references?: { model: string; onDelete?: string; array?: boolean }
  /** Element type of an `array` property (scalar labels). */
  arrayOf?: string
  unique?: boolean
  searchable?: boolean
  immutable?: boolean
  pii?: boolean
  constraints?: Record<string, unknown>
}

export interface CodegenModel {
  name: string
  description?: string
  /** Parent model NAME (single inheritance). */
  inherits?: string
  identifier?: { property: string; strategy: string }
  timestamps?: boolean
  softDelete?: boolean
  volumetry?: string
  /** OWN properties only — inherited ones come from `inherits`. Use this
   * for the type declaration so `extends {{ inherits }}` stays clean. */
  properties: CodegenProperty[]
  /** Own + inherited properties, flattened (root ancestor first). Use this
   * whenever a COMPLETE instance is needed — seed/example data, DB columns,
   * full request/response bodies — so inherited fields are never dropped. */
  allProperties: CodegenProperty[]
  examples: { name: string; values: Record<string, unknown> }[]
}

export interface CodegenRouteResponse {
  code: string
  description?: string
  model?: string
  list?: boolean
  paginated?: boolean
  example?: string
}

export interface CodegenRoute {
  method: string
  /** Group-relative path, `{param}` spelling. */
  path: string
  /** Fully composed served path (design base path + version prefix +
   * group base path), `{param}` spelling. */
  fullPath: string
  summary?: string
  description?: string
  operationId?: string
  /** Path parameter names in order of appearance. */
  params: { name: string; property?: { model: string; property: string } }[]
  body?: { model: string; contentType?: string }
  responses: CodegenRouteResponse[]
  /** The auth contract this route actually enforces (effective). */
  auth: string
  pagination?: { style: string; defaultLimit?: number; maxLimit?: number }
  idempotent?: boolean
  cacheSeconds?: number
  deprecated?: boolean
}

export interface CodegenGroup {
  name: string
  description?: string
  basePath?: string
  versionPrefix?: string
  headers: { name: string; example?: string; description?: string }[]
  routes: CodegenRoute[]
}

// ── Projection ────────────────────────────────────────────────────────

/** `{{param}}` → `{param}` — the neutral spelling templates consume. */
function templatePath(pattern: string): string {
  return pattern.replace(/\{\{([^{}]+)\}\}/g, '{$1}')
}

function modelName(design: ApiDesign, id: string | undefined): string | undefined {
  if (id === undefined) return undefined
  const model = design.models.find((m) => m.id === id)
  return model?.doc.name
}

function enumName(design: ApiDesign, id: string): string | undefined {
  return design.enums.find((e) => e.id === id)?.doc.name
}

function projectProperty(design: ApiDesign, property: DesignModel['properties'][number]): CodegenProperty {
  const doc = property.doc
  const meta = property.design
  const reference = meta?.reference
  const out: CodegenProperty = {
    name: doc.name,
    type: doc.type,
    required: doc.required
  }
  if (doc.format !== undefined) out.format = doc.format
  if (doc.readOnly === true) out.readOnly = true
  if (meta?.writeOnly === true) out.writeOnly = true
  if (doc.nullable === true) out.nullable = true
  if (doc.description !== undefined) out.description = doc.description
  if (doc.example !== undefined) out.example = doc.example
  if (meta?.defaultValue !== undefined) out.default = meta.defaultValue
  if (reference?.target === 'enum') {
    const name = enumName(design, reference.refId)
    if (name !== undefined) out.enum = name
  }
  if (reference?.target === 'model') {
    const name = modelName(design, reference.refId)
    if (name !== undefined) {
      out.references = {
        model: name,
        ...(reference.onDelete !== undefined ? { onDelete: reference.onDelete } : {}),
        ...(doc.isArrayOfRef === true ? { array: true } : {})
      }
    }
  }
  if (doc.type === 'array' && meta?.arrayItems?.type !== undefined) out.arrayOf = meta.arrayItems.type
  if (meta?.unique === true) out.unique = true
  if (meta?.searchable === true) out.searchable = true
  if (meta?.immutable === true) out.immutable = true
  if (property.intents?.pii === true) out.pii = true
  if (doc.constraints !== undefined && Object.keys(doc.constraints).length > 0) {
    out.constraints = { ...doc.constraints } as Record<string, unknown>
  }
  return out
}

function projectModel(design: ApiDesign, model: DesignModel): CodegenModel {
  const identifierId = model.design?.identifier?.propertyId
  const identifierName = identifierId !== undefined
    ? model.properties.find((p) => p.id === identifierId)?.doc.name
    : undefined
  // Flatten the inheritance chain (root ancestor first, cycle-tolerant) so
  // templates have every field of a complete instance without re-walking
  // `inherits` themselves — the seed/example gap the walkthrough found.
  const chain: DesignModel[] = []
  const visited = new Set<string>()
  let current: DesignModel | undefined = model
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    chain.unshift(current)
    const parentId: string | undefined = current.design?.inheritsFrom
    current = parentId === undefined ? undefined : design.models.find((m) => m.id === parentId)
  }
  const out: CodegenModel = {
    name: model.doc.name,
    properties: model.properties.map((p) => projectProperty(design, p)),
    allProperties: chain.flatMap((m) => m.properties).map((p) => projectProperty(design, p)),
    examples: (model.examples ?? []).map((example) => ({
      name: example.name,
      values: Object.fromEntries(
        Object.entries(example.values).map(([propertyId, value]) => {
          const name = chain.flatMap((m) => m.properties).find((p) => p.id === propertyId)?.doc.name ?? propertyId
          return [name, value]
        })
      )
    }))
  }
  if (model.doc.description !== undefined) out.description = model.doc.description
  const parentName = modelName(design, model.design?.inheritsFrom)
  if (parentName !== undefined) out.inherits = parentName
  if (identifierName !== undefined && model.design?.identifier !== undefined) {
    out.identifier = { property: identifierName, strategy: model.design.identifier.strategy }
  }
  if (model.design?.timestamps === true) out.timestamps = true
  if (model.design?.softDelete === true) out.softDelete = true
  if (model.intents?.volumetry !== undefined) out.volumetry = model.intents.volumetry
  return out
}

function projectRoute(design: ApiDesign, group: DesignRouteGroup, route: DesignRoute): CodegenRoute {
  const meta = route.design
  const fullPattern = composeRoutePath({
    ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
    groupBasePath: groupChainBasePath(design, group)
  }, route.doc.match.urlPattern)
  const out: CodegenRoute = {
    method: (route.doc.match.method ?? 'GET').toUpperCase(),
    path: templatePath(route.doc.match.urlPattern),
    fullPath: templatePath(fullPattern),
    params: routePathParams(route.doc.match.urlPattern).map((name) => {
      const link = meta?.paramLinks?.[name]
      const model = link !== undefined ? design.models.find((m) => m.id === link.modelId) : undefined
      const property = model?.properties.find((p) => p.id === link?.propertyId)
      return {
        name,
        ...(model !== undefined && property !== undefined
          ? { property: { model: model.doc.name, property: property.doc.name } }
          : {})
      }
    }),
    responses: Object.entries(route.doc.responses ?? {}).map(([code, doc]) => {
      const responseMeta = meta?.responses?.[code]
      const boundModel = modelName(design, responseMeta?.modelId)
      const exampleId = responseMeta?.exampleId
      const bound = responseMeta?.modelId !== undefined
        ? design.models.find((m) => m.id === responseMeta.modelId)
        : undefined
      const exampleName = exampleId !== undefined
        ? (bound?.examples ?? []).find((e) => e.id === exampleId)?.name
        : undefined
      const response: CodegenRouteResponse = { code }
      if (doc.description !== undefined) response.description = doc.description
      if (boundModel !== undefined) response.model = boundModel
      if (responseMeta?.list === true) response.list = true
      if (responseMeta?.paginated === true) response.paginated = true
      if (exampleName !== undefined) response.example = exampleName
      return response
    }),
    auth: effectiveAuth(design, group, route)
  }
  if (route.doc.summary !== undefined) out.summary = route.doc.summary
  if (route.doc.description !== undefined) out.description = route.doc.description
  if (route.doc.operationId !== undefined) out.operationId = route.doc.operationId
  const bodyModel = modelName(design, meta?.body?.modelId)
  if (bodyModel !== undefined) {
    out.body = {
      model: bodyModel,
      ...(meta?.body?.contentType !== undefined ? { contentType: meta.body.contentType } : {})
    }
  }
  if (meta?.pagination !== undefined) {
    out.pagination = {
      style: meta.pagination.style,
      ...(meta.pagination.defaultLimit !== undefined ? { defaultLimit: meta.pagination.defaultLimit } : {}),
      ...(meta.pagination.maxLimit !== undefined ? { maxLimit: meta.pagination.maxLimit } : {})
    }
  }
  if (meta?.idempotent === true) out.idempotent = true
  if (typeof meta?.cacheSeconds === 'number' && meta.cacheSeconds > 0) out.cacheSeconds = meta.cacheSeconds
  if (route.doc.deprecated === true) out.deprecated = true
  return out
}

/** Build the template context from a design — deterministic, complete,
 * and free of internal ids. */
export function buildCodegenContext(design: ApiDesign): CodegenContext {
  return {
    contextVersion: CODEGEN_CONTEXT_VERSION,
    design: {
      name: design.info.title !== '' ? design.info.title : design.name,
      ...(design.info.version !== undefined ? { version: design.info.version } : {}),
      ...(design.info.description !== undefined ? { description: design.info.description } : {}),
      ...(design.server?.basePath !== undefined ? { basePath: design.server.basePath } : {}),
      defaultAuth: design.defaultAuth ?? 'none'
    },
    enums: design.enums
      .filter((e) => (e.doc.enumValues ?? []).length > 0)
      .map((e) => ({
        name: e.doc.name,
        ...(e.doc.description !== undefined ? { description: e.doc.description } : {}),
        values: (e.doc.enumValues ?? []).map((v) => (typeof v === 'number' ? v : String(v)))
      })),
    models: design.models.map((m) => projectModel(design, m)),
    groups: design.routeGroups.map((group) => {
      const out: CodegenGroup = {
        name: group.doc.name,
        headers: (group.design?.headers ?? []).map((h) => ({
          name: h.name,
          ...(h.example !== undefined ? { example: h.example } : {}),
          ...(h.description !== undefined ? { description: h.description } : {})
        })),
        routes: group.routes.map((route) => projectRoute(design, group, route))
      }
      if (group.doc.description !== undefined) out.description = group.doc.description
      if (group.design?.basePath !== undefined) out.basePath = group.design.basePath
      if (group.design?.versionPrefix !== undefined) out.versionPrefix = group.design.versionPrefix
      return out
    })
  }
}
