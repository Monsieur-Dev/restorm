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
  DesignProperty,
  DesignRoute,
  DesignRouteGroup
} from '../types/apiDesign'
import { composeRoutePath, groupChainBasePath } from './apiDesignDoc'
import { routePathParams } from './designRoutes'
import { effectiveAuth } from './designServing'
import {
  resolveScopeVars,
  type TemplateVariableDecl,
  type TemplateVarValues,
  type CodegenVarError
} from './templateVariables'

/** Bump ONLY with a documented migration note — template manifests
 * pin the versions they understand. */
export const CODEGEN_CONTEXT_VERSION = 1

/**
 * Everything needed to resolve a template's user-declared variables into the
 * context, injected into {@link buildCodegenContext}. Absent → the context
 * carries no `vars` (existing behaviour). The Handlebars `evaluate` is injected
 * so this shared module stays engine-free; `errors` is appended to in place and
 * surfaced to the user (never thrown).
 */
export interface CodegenVarsBinding {
  decls: readonly TemplateVariableDecl[]
  /** Global values (per template), one map per scope. */
  values?: TemplateVarValues
  /** Per-entity override lookups (this design's stored values for the template). */
  modelOverrides?: (modelId: string) => Record<string, string> | undefined
  propertyOverrides?: (propertyId: string) => Record<string, string> | undefined
  routeOverrides?: (routeId: string) => Record<string, string> | undefined
  evaluate: (expression: string, context: Record<string, unknown>) => string
  errors: CodegenVarError[]
}

export interface CodegenContext {
  contextVersion: number
  design: {
    name: string
    version?: string
    description?: string
    basePath?: string
    defaultAuth: string
    /** Resolved PROJECT-scope user variables a custom template declared in its
     * manifest (`ctx.design.vars.<name>`). Absent when the template declares none. */
    vars?: Record<string, unknown>
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
  /** Resolved PROPERTY-scope user variables (`ctx.models[].properties[].vars.<name>`),
   * evaluated per property. Absent when the template declares none. */
  vars?: Record<string, unknown>
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
  /** Resolved MODEL-scope user variables (`ctx.models[].vars.<name>`), evaluated
   * per model. Absent when the template declares none. */
  vars?: Record<string, unknown>
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
  /** Resolved ROUTE-scope user variables (`ctx.groups[].routes[].vars.<name>`),
   * evaluated per route. Absent when the template declares none. */
  vars?: Record<string, unknown>
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

/** Resolve PROPERTY-scope variables for one projected property and attach them
 * (mutates `propCtx.vars`). The override lives on the property's own design meta
 * (so an inherited property carries the override from where it is declared). */
function resolvePropertyVars(
  src: DesignModel['properties'][number],
  propCtx: CodegenProperty,
  modelCtx: CodegenModel,
  designCtx: CodegenContext['design'],
  binding: CodegenVarsBinding
): void {
  const resolved = resolveScopeVars({
    decls: binding.decls,
    scope: 'property',
    global: binding.values?.property,
    overrides: binding.propertyOverrides?.(src.id),
    evalContext: { design: designCtx, model: modelCtx, property: propCtx },
    entity: `${modelCtx.name}.${propCtx.name}`,
    evaluate: binding.evaluate
  })
  binding.errors.push(...resolved.errors)
  if (Object.keys(resolved.values).length > 0) propCtx.vars = resolved.values
}

function projectModel(
  design: ApiDesign,
  model: DesignModel,
  binding?: CodegenVarsBinding,
  designCtx?: CodegenContext['design']
): CodegenModel {
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
  const chainProps = chain.flatMap((m) => m.properties)
  const out: CodegenModel = {
    name: model.doc.name,
    properties: model.properties.map((p) => projectProperty(design, p)),
    allProperties: chainProps.map((p) => projectProperty(design, p)),
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
  if (binding !== undefined && designCtx !== undefined) {
    const resolved = resolveScopeVars({
      decls: binding.decls,
      scope: 'model',
      global: binding.values?.model,
      overrides: binding.modelOverrides?.(model.id),
      evalContext: { design: designCtx, model: out },
      entity: model.doc.name,
      evaluate: binding.evaluate
    })
    binding.errors.push(...resolved.errors)
    if (Object.keys(resolved.values).length > 0) out.vars = resolved.values
    // Property-scope variables resolve per property, against {design, model,
    // property}. Own + inherited lists hold distinct projected objects but map
    // 1:1 (by index) onto their source arrays, so the override is read from the
    // property where it is declared.
    out.properties.forEach((propCtx, i) => {
      const src = model.properties[i]
      if (src !== undefined) resolvePropertyVars(src, propCtx, out, designCtx, binding)
    })
    out.allProperties.forEach((propCtx, i) => {
      const src = chainProps[i]
      if (src !== undefined) resolvePropertyVars(src, propCtx, out, designCtx, binding)
    })
  }
  return out
}

function projectRoute(
  design: ApiDesign,
  group: DesignRouteGroup,
  route: DesignRoute,
  binding?: CodegenVarsBinding,
  designCtx?: CodegenContext['design'],
  groupCtx?: Omit<CodegenGroup, 'routes'>
): CodegenRoute {
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
  if (binding !== undefined && designCtx !== undefined) {
    const resolved = resolveScopeVars({
      decls: binding.decls,
      scope: 'route',
      global: binding.values?.route,
      overrides: binding.routeOverrides?.(route.id),
      evalContext: { design: designCtx, ...(groupCtx !== undefined ? { group: groupCtx } : {}), route: out },
      entity: route.doc.summary ?? out.fullPath,
      evaluate: binding.evaluate
    })
    binding.errors.push(...resolved.errors)
    if (Object.keys(resolved.values).length > 0) out.vars = resolved.values
  }
  return out
}

/** The `design` slice of the context — shared by the full builder and the
 * per-entity eval-context helper. */
function designContext(design: ApiDesign): CodegenContext['design'] {
  return {
    name: design.info.title !== '' ? design.info.title : design.name,
    ...(design.info.version !== undefined ? { version: design.info.version } : {}),
    ...(design.info.description !== undefined ? { description: design.info.description } : {}),
    ...(design.server?.basePath !== undefined ? { basePath: design.server.basePath } : {}),
    defaultAuth: design.defaultAuth ?? 'none'
  }
}

/**
 * The Handlebars eval-context slice a variable's expression is evaluated
 * against for one entity — and, flattened, exactly the set of contextual
 * variables the value editor should offer. `{design}` for project scope,
 * `{design, model}` for a model, `{design, model, property}` for a property,
 * `{design, group, route}` for a route.
 */
export function codegenEvalContext(
  design: ApiDesign,
  entity: { model?: DesignModel; property?: DesignProperty; group?: DesignRouteGroup; route?: DesignRoute }
): Record<string, unknown> {
  const out: Record<string, unknown> = { design: designContext(design) }
  if (entity.model !== undefined) {
    const modelCtx = projectModel(design, entity.model)
    out['model'] = modelCtx
    if (entity.property !== undefined) {
      out['property'] = projectProperty(design, entity.property)
    }
  }
  if (entity.group !== undefined && entity.route !== undefined) {
    const group: CodegenGroup = {
      name: entity.group.doc.name,
      headers: (entity.group.design?.headers ?? []).map((h) => ({
        name: h.name,
        ...(h.example !== undefined ? { example: h.example } : {}),
        ...(h.description !== undefined ? { description: h.description } : {})
      })),
      routes: []
    }
    if (entity.group.doc.description !== undefined) group.description = entity.group.doc.description
    if (entity.group.design?.basePath !== undefined) group.basePath = entity.group.design.basePath
    if (entity.group.design?.versionPrefix !== undefined) group.versionPrefix = entity.group.design.versionPrefix
    const { routes: _routes, ...groupCtx } = group
    out['group'] = groupCtx
    out['route'] = projectRoute(design, entity.group, entity.route)
  }
  return out
}

/** Build the template context from a design — deterministic, complete,
 * and free of internal ids. Pass `binding` to also resolve a template's
 * user-declared variables into `ctx.*.vars` (see {@link CodegenVarsBinding}). */
export function buildCodegenContext(design: ApiDesign, binding?: CodegenVarsBinding): CodegenContext {
  const designCtx: CodegenContext['design'] = designContext(design)
  // Project-scope variables resolve once, against the design context.
  if (binding !== undefined) {
    const resolved = resolveScopeVars({
      decls: binding.decls,
      scope: 'project',
      global: binding.values?.project,
      evalContext: { design: designCtx },
      evaluate: binding.evaluate
    })
    binding.errors.push(...resolved.errors)
    if (Object.keys(resolved.values).length > 0) designCtx.vars = resolved.values
  }
  return {
    contextVersion: CODEGEN_CONTEXT_VERSION,
    design: designCtx,
    enums: design.enums
      .filter((e) => (e.doc.enumValues ?? []).length > 0)
      .map((e) => ({
        name: e.doc.name,
        ...(e.doc.description !== undefined ? { description: e.doc.description } : {}),
        values: (e.doc.enumValues ?? []).map((v) => (typeof v === 'number' ? v : String(v)))
      })),
    models: design.models.map((m) => projectModel(design, m, binding, designCtx)),
    groups: design.routeGroups.map((group) => {
      const out: CodegenGroup = {
        name: group.doc.name,
        headers: (group.design?.headers ?? []).map((h) => ({
          name: h.name,
          ...(h.example !== undefined ? { example: h.example } : {}),
          ...(h.description !== undefined ? { description: h.description } : {})
        })),
        routes: []
      }
      if (group.doc.description !== undefined) out.description = group.doc.description
      if (group.design?.basePath !== undefined) out.basePath = group.design.basePath
      if (group.design?.versionPrefix !== undefined) out.versionPrefix = group.design.versionPrefix
      // Routes project AFTER the group's own fields so route-scope variables can
      // read `group.*` in their eval context.
      const { routes: _routes, ...groupCtx } = out
      out.routes = group.routes.map((route) => projectRoute(design, group, route, binding, designCtx, groupCtx))
      return out
    })
  }
}
