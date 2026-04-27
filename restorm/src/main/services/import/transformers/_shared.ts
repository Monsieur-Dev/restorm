/**
 * Shared helpers for OpenAPI-family transformers (Swagger 2.0, OpenAPI 3.0,
 * OpenAPI 3.1). Everything here is **version-agnostic** — it operates on the
 * minimal subset of fields that all three specs share, or on shapes the
 * caller has already normalised to a common form.
 *
 * The intent is *share helpers, don't down-convert* (per the architecture in
 * the parent ticket). Every transformer keeps its own version-specific entry
 * point and feeds the shared helpers small, normalised pieces.
 */
import type {
  ApiContact,
  ApiInfo,
  ApiLicense,
  ExternalDocs,
  GroupDocumentation,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation,
  ResponseDocumentation
} from '../../../../shared/types/apiDocumentation'

/** All HTTP verbs Restorm imports map onto operations. Order matters for the deterministic walk. */
export const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

// ────────────────────────────────────────────────────────────────────────────
// Common, version-agnostic schema shape
// ────────────────────────────────────────────────────────────────────────────
//
// Both Swagger 2.0 and OpenAPI 3.x build their `schema` object out of the
// same JSON-Schema-ish primitives (`type`, `format`, `items`,
// `properties`, `required`, `$ref`, …). The shape below is the common
// subset; per-version shims add their own narrower types alongside.
//
export interface CommonSchema {
  $ref?: string
  type?: string | string[]            // 3.1 allows arrays (replaces `nullable`)
  format?: string
  description?: string
  items?: CommonSchema
  additionalProperties?: CommonSchema | boolean
  properties?: Record<string, CommonSchema>
  required?: string[]
  enum?: unknown[]
  nullable?: boolean                  // 2.0 + 3.0 (gone in 3.1)
  oneOf?: CommonSchema[]
  anyOf?: CommonSchema[]
  allOf?: CommonSchema[]
  example?: unknown
  examples?: Record<string, unknown> | unknown[]
  default?: unknown
}

/** Last segment of a `#/foo/bar/Name` JSON Pointer. */
export function refName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] ?? ref
}

/** Render a JSON-Schema-ish node as a short human label (`array<Pet>`, `string`, `Pet`, `any`). */
export function schemaTypeLabel(schema: CommonSchema, depth = 0): string {
  if (depth > 5) return '...'
  if (schema.$ref) return refName(schema.$ref)
  if (schema.type === 'array' && schema.items) return `array<${schemaTypeLabel(schema.items, depth + 1)}>`
  if (Array.isArray(schema.type)) {
    // OAS 3.1: `["string", "null"]` collapses to `string` for the label.
    const nonNull = schema.type.find((t) => t !== 'null') ?? schema.type[0]
    return typeof nonNull === 'string' ? nonNull : 'any'
  }
  if (typeof schema.type === 'string') return schema.type
  if (schema.properties) return 'object'
  return 'any'
}

/** Walk every nested schema reachable from `schema` and call `visit` on each `$ref`. */
export function walkSchemaRefs(schema: CommonSchema | undefined, visit: (refName: string) => void): void {
  if (!schema) return
  if (schema.$ref) visit(refName(schema.$ref))
  if (schema.items) walkSchemaRefs(schema.items, visit)
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    walkSchemaRefs(schema.additionalProperties, visit)
  }
  if (schema.properties) {
    for (const child of Object.values(schema.properties)) walkSchemaRefs(child, visit)
  }
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = schema[key]
    if (Array.isArray(branches)) {
      for (const child of branches) walkSchemaRefs(child, visit)
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Common, version-agnostic operation pieces
// ────────────────────────────────────────────────────────────────────────────

/** Normalised parameter (query / path / header / cookie). The caller flattens
 * Swagger 2.0's inline `type`/`format` into a synthesized `schema` so this
 * shape works for both 2.0 and 3.x. */
export interface CommonParameter {
  name: string
  in: string
  description?: string
  required?: boolean
  schema?: CommonSchema
  default?: unknown
  example?: unknown
}

/** Normalised response (the value part of the responses map). */
export interface CommonResponse {
  description?: string
  /** Single schema label or `$ref` name — the transformer collapses 3.x's
   * multi-content-type responses to the most informative entry. */
  schema?: CommonSchema
  headers?: Record<string, { type: string; description?: string }>
}

/** Tag from the `tags[]` array. Same shape across 2.0 and 3.x. */
export interface CommonTag {
  name: string
  description?: string
  externalDocs?: ExternalDocs
}

/** A parameter signature the metadata transformer can render. */
export function mapParameterToDocumentation(p: CommonParameter): ParameterDocumentation {
  const entry: ParameterDocumentation = {
    name: p.name,
    location: p.in,
    type: p.schema ? schemaTypeLabel(p.schema) : 'any',
    required: p.required ?? false
  }
  if (p.description !== undefined) entry.description = p.description
  if (p.default !== undefined) {
    const raw = p.default
    if (typeof raw === 'string') entry.defaultValue = raw
    else if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') entry.defaultValue = String(raw)
    else {
      try { entry.defaultValue = JSON.stringify(raw) } catch { /* circular ref — drop */ }
    }
  }
  return entry
}

/** Map a list of `CommonParameter` onto `ParameterDocumentation[]`. */
export function mapParameters(params: CommonParameter[] | undefined): ParameterDocumentation[] | undefined {
  if (!params || params.length === 0) return undefined
  return params.map(mapParameterToDocumentation)
}

/** Map a `responses` map onto the documentation shape. */
export function mapResponses(
  responses: Record<string, CommonResponse> | undefined
): Record<string, ResponseDocumentation> | undefined {
  if (!responses) return undefined
  const out: Record<string, ResponseDocumentation> = {}
  for (const [code, resp] of Object.entries(responses)) {
    const entry: ResponseDocumentation = {}
    if (resp.description) entry.description = resp.description
    if (resp.schema?.$ref) entry.schema = refName(resp.schema.$ref)
    else if (resp.schema) entry.schema = schemaTypeLabel(resp.schema)
    if (resp.headers) entry.headers = resp.headers
    out[code] = entry
  }
  return out
}

/** Map a tag list onto the documentation groups map. */
export function mapTagsToGroups(tags: CommonTag[] | undefined): Record<string, GroupDocumentation> {
  if (!tags) return {}
  const out: Record<string, GroupDocumentation> = {}
  for (const tag of tags) {
    const entry: GroupDocumentation = { name: tag.name }
    if (tag.description !== undefined) entry.description = tag.description
    if (tag.externalDocs !== undefined) entry.externalDocs = tag.externalDocs
    out[tag.name] = entry
  }
  return out
}

/** Build a `ModelDocumentation`-shaped property list from a schema's `properties` map. */
export function mapSchemaProperties(schema: CommonSchema): PropertyDocumentation[] {
  const required = new Set(schema.required ?? [])
  const properties: PropertyDocumentation[] = []
  for (const [propName, propSchema] of Object.entries(schema.properties ?? {})) {
    const prop: PropertyDocumentation = {
      name: propName,
      type: schemaTypeLabel(propSchema),
      required: required.has(propName)
    }
    if (propSchema.description !== undefined) prop.description = propSchema.description
    properties.push(prop)
  }
  return properties
}

// ────────────────────────────────────────────────────────────────────────────
// `info` block
// ────────────────────────────────────────────────────────────────────────────

/** Common fields on the `info` block. Both 2.0 and 3.x use this shape. */
export interface CommonInfo {
  title: string
  description?: string
  version?: string
  termsOfService?: string
  contact?: ApiContact
  license?: ApiLicense
  /** OAS 3.x only — passes through if present, otherwise undefined. */
  summary?: string
}

/** Transfer an `info` block onto `ApiInfo`, copying only fields the spec actually defined. */
export function buildApiInfo(info: CommonInfo, externalDocs?: ExternalDocs): ApiInfo {
  const out: ApiInfo = { title: info.title }
  if (info.description !== undefined) out.description = info.description
  if (info.version !== undefined) out.version = info.version
  if (info.contact !== undefined) out.contact = info.contact
  if (info.license !== undefined) out.license = info.license
  if (info.termsOfService !== undefined) out.termsOfService = info.termsOfService
  if (externalDocs !== undefined) out.externalDocs = externalDocs
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// URL templating
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert OpenAPI's path-template `{var}` syntax to Restorm's Handlebars
 * `{{var}}` syntax. The two are isomorphic for parameter substitution; doing
 * it at import time means runtime resolution goes through `ContextService`
 * exactly like every other variable in the app.
 *
 * `{}` placeholders inside literals (e.g. CSS units) are left alone — the
 * regex requires an identifier inside the braces.
 */
export function rewriteUrlTemplate(template: string): string {
  return template.replace(/\{([A-Za-z_$][A-Za-z0-9_$.\-]*)\}/g, '{{$1}}')
}

// ────────────────────────────────────────────────────────────────────────────
// Operation documentation row
// ────────────────────────────────────────────────────────────────────────────

/** Shape a transformer hands to `buildOperationDocumentation` — already
 * normalised across versions. */
export interface OperationDocumentationInput {
  path: string
  method: HttpMethod
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  deprecated?: boolean
  externalDocs?: ExternalDocs
  consumes?: string[]
  produces?: string[]
  parameters?: CommonParameter[]
  responses?: Record<string, CommonResponse>
  security?: Record<string, string[]>[]
  /** Pre-collected `$ref` names referenced by this operation. */
  referencedModels?: string[]
  /** Protocol- or version-specific extras (callbacks, links, raw multi-content-type, …). */
  extra?: Record<string, unknown>
}

/** Build a single `OperationDocumentation` row from a normalised operation. */
export function buildOperationDocumentation(op: OperationDocumentationInput): OperationDocumentation {
  const doc: OperationDocumentation = {
    match: {
      urlPattern: op.path,
      method: op.method.toUpperCase()
    }
  }
  if (op.tags?.[0] !== undefined) doc.group = op.tags[0]
  if (op.summary !== undefined) doc.summary = op.summary
  if (op.description !== undefined) doc.description = op.description
  if (op.operationId !== undefined) doc.operationId = op.operationId
  if (op.deprecated) doc.deprecated = true
  if (op.externalDocs !== undefined) doc.externalDocs = op.externalDocs
  if (op.consumes !== undefined) doc.consumes = op.consumes
  if (op.produces !== undefined) doc.produces = op.produces
  const params = mapParameters(op.parameters)
  if (params !== undefined) doc.parameters = params
  const responses = mapResponses(op.responses)
  if (responses !== undefined) doc.responses = responses
  if (op.security !== undefined) doc.security = op.security
  if (op.referencedModels && op.referencedModels.length > 0) doc.referencedModels = op.referencedModels
  if (op.extra && Object.keys(op.extra).length > 0) doc.extra = op.extra
  return doc
}

// ────────────────────────────────────────────────────────────────────────────
// `$ref` resolver — same JSON Pointer walker for every spec version
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a JSON Pointer (`#/foo/bar/Baz`) against a parsed spec. The walker
 * is version-agnostic: it just chases path segments. Per-version transformers
 * pass the already-parsed root and rely on the segments differing between
 * 2.0 (`#/definitions/...`) and 3.x (`#/components/schemas/...`).
 */
export function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined
  const path = pointer.slice(2).split('/').map(decodeJsonPointerSegment)
  let current: unknown = root
  for (const segment of path) {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return current
}

/** RFC 6901 segment decoding (`~1` → `/`, `~0` → `~`). */
function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}
