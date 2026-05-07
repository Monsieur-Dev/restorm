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
  ResponseDocumentation,
  SchemaConstraints
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
  readOnly?: boolean
  oneOf?: CommonSchema[]
  anyOf?: CommonSchema[]
  allOf?: CommonSchema[]
  /** Polymorphism: which property's value picks the concrete subtype.
   * Swagger 2.0 + OAS 3.x both carry this on the parent (`Pet`
   * with subclasses Dog / Cat selected by `petType`). */
  discriminator?: { propertyName: string; mapping?: Record<string, string> } | string
  /** XML serialisation hints — same shape on both versions. */
  xml?: {
    name?: string
    attribute?: boolean
    wrapped?: boolean
    prefix?: string
    namespace?: string
  }
  /** Swagger 2.0 nullability vendor extension; `nullable` is the
   * spec-blessed equivalent in OAS 3.0. Both flow into the same
   * `nullable` flag downstream. */
  'x-nullable'?: boolean
  example?: unknown
  examples?: Record<string, unknown> | unknown[]
  default?: unknown
  // Validation constraints — `boolean` and `number` overlap on
  // `exclusiveMinimum` / `exclusiveMaximum` to accept both Swagger 2.0
  // / OAS 3.0 (boolean flag) and OAS 3.1 (numeric threshold) without
  // a per-version split.
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: boolean | number
  exclusiveMaximum?: boolean | number
  pattern?: string
  multipleOf?: number
  uniqueItems?: boolean
}

/** Last segment of a `#/foo/bar/Name` JSON Pointer. */
export function refName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] ?? ref
}

/** Collect every `x-*` key from a Swagger / OpenAPI source object
 * into a plain bag, skipping `x-example` because it has its own
 * dedicated path on parameters / properties (mapped onto
 * `example` so the doc viewer renders it as a first-class
 * payload). Returns `undefined` when the node carries no other
 * vendor extensions, so callers can avoid attaching an empty
 * object.
 *
 * Accepts `unknown` so transformers don't need a double-cast
 * (`as unknown as Record<string, unknown>`) when their named
 * source-spec interfaces lack an index signature. The function
 * itself narrows safely. */
export function extractVendorExtensions(
  node: unknown
): Record<string, unknown> | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!key.startsWith('x-')) continue
    if (key === 'x-example') continue
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
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
  /** Pluralised examples — `Record<string, unknown>` for OAS 3.x
   * named example objects, `unknown[]` for ad-hoc arrays. */
  examples?: Record<string, unknown> | unknown[]
  /** Swagger 2.0 only: array-encoding hint. */
  collectionFormat?: string
  /** Swagger 2.0 only: parameter may be transmitted with empty value. */
  allowEmptyValue?: boolean
}

/** Normalised response (the value part of the responses map). */
export interface CommonResponse {
  description?: string
  /** Single schema label or `$ref` name — the transformer collapses 3.x's
   * multi-content-type responses to the most informative entry. */
  schema?: CommonSchema
  headers?: Record<string, { type: string; description?: string }>
  /** Per-content-type examples carried as-is from the source spec.
   * Swagger 2.0 keys these by media type (`application/json`, …);
   * OAS 3.x bundles them per content-object. */
  examples?: Record<string, unknown>
}

/** Tag from the `tags[]` array. Same shape across 2.0 and 3.x. */
export interface CommonTag {
  name: string
  description?: string
  externalDocs?: ExternalDocs
}

/** Pull validation constraints out of a schema node into a flat
 * `SchemaConstraints` object. Only fields the source spec actually
 * defined are copied — undefined entries stay omitted so the
 * downstream `if (constraints)` check stays meaningful. Returns
 * `undefined` when the source schema carries no constraints at all,
 * so callers can avoid attaching an empty object. */
export function extractSchemaConstraints(schema: CommonSchema | undefined): SchemaConstraints | undefined {
  if (!schema) return undefined
  const out: SchemaConstraints = {}
  if (schema.minLength !== undefined) out.minLength = schema.minLength
  if (schema.maxLength !== undefined) out.maxLength = schema.maxLength
  if (schema.minimum !== undefined) out.minimum = schema.minimum
  if (schema.maximum !== undefined) out.maximum = schema.maximum
  if (schema.exclusiveMinimum !== undefined) out.exclusiveMinimum = schema.exclusiveMinimum
  if (schema.exclusiveMaximum !== undefined) out.exclusiveMaximum = schema.exclusiveMaximum
  if (schema.pattern !== undefined) out.pattern = schema.pattern
  if (schema.multipleOf !== undefined) out.multipleOf = schema.multipleOf
  if (schema.uniqueItems !== undefined) out.uniqueItems = schema.uniqueItems
  return Object.keys(out).length > 0 ? out : undefined
}

/** A parameter signature the metadata transformer can render. */
export function mapParameterToDocumentation(p: CommonParameter): ParameterDocumentation {
  const entry: ParameterDocumentation = {
    name: p.name,
    location: p.in,
    type: p.schema ? schemaTypeLabel(p.schema) : 'any',
    required: p.required ?? false
  }
  if (p.schema?.format !== undefined) entry.format = p.schema.format
  if (p.description !== undefined) entry.description = p.description
  if (p.default !== undefined) {
    const raw = p.default
    if (typeof raw === 'string') entry.defaultValue = raw
    else if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') entry.defaultValue = String(raw)
    else {
      try { entry.defaultValue = JSON.stringify(raw) } catch { /* circular ref — drop */ }
    }
  }
  if (p.example !== undefined) entry.example = p.example
  if (p.examples !== undefined) entry.examples = p.examples
  if (p.collectionFormat !== undefined) entry.collectionFormat = p.collectionFormat
  if (p.allowEmptyValue !== undefined) entry.allowEmptyValue = p.allowEmptyValue
  if (p.schema?.enum !== undefined) entry.enumValues = p.schema.enum
  const constraints = extractSchemaConstraints(p.schema)
  if (constraints !== undefined) entry.constraints = constraints
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
    if (resp.examples && Object.keys(resp.examples).length > 0) entry.examples = resp.examples
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

/** Detect whether a schema is `type: ["X", "null"]` (OAS 3.1
 * nullability). Safe no-op for Swagger 2.0 / OAS 3.0 where `type` is
 * a single string and the function returns `false`. */
function hasNullInTypeArray(schema: CommonSchema): boolean {
  return Array.isArray(schema.type) && schema.type.some((t) => t === 'null')
}

/** Resolve `(targetModelRef, isArrayOfRef)` from a schema:
 *
 * - `{ $ref: "#/.../Pet" }` → `{ ref: "Pet", isArray: false }`
 * - `{ type: "array", items: { $ref: "#/.../Pet" } }` → `{ ref: "Pet", isArray: true }`
 * - anything else → `undefined`
 *
 * Used to surface relationship metadata on documented properties so
 * the viewer can wire clickable cross-references and feed the Mermaid
 * relationship diagram without having to re-parse the type label
 * string.
 */
export function resolveModelRef(schema: CommonSchema): { ref: string; isArray: boolean } | undefined {
  if (schema.$ref) return { ref: refName(schema.$ref), isArray: false }
  if (schema.type === 'array' && schema.items?.$ref) {
    return { ref: refName(schema.items.$ref), isArray: true }
  }
  return undefined
}

/**
 * Recursively merge a schema's `allOf` branches into the parent. Only
 * inline (non-`$ref`) branches are merged — referenced branches stay
 * as cross-references in the documentation graph (the model viewer
 * already renders the inheritance edges from `targetModelRef`). The
 * walk has a depth fuse to defend against pathological cycles in
 * malformed specs.
 *
 * Properties / required / description / xml hints from the branches
 * land on the parent. The parent's own fields win on conflict — that
 * matches OpenAPI's "more specific wins" intent for hand-edited
 * inheritance hierarchies.
 *
 * Returns the same `CommonSchema` reference (mutated in place) for
 * chaining; safe to call on a schema with no `allOf`.
 */
export function mergeAllOfInto(schema: CommonSchema, depth = 0): CommonSchema {
  if (depth > 8) return schema
  if (!schema.allOf || schema.allOf.length === 0) return schema
  const properties: Record<string, CommonSchema> = { ...(schema.properties ?? {}) }
  const required = new Set(schema.required ?? [])
  for (const branch of schema.allOf) {
    // Inline branches only — `$ref` branches stay as cross-references
    // so the model graph keeps showing the inheritance edge.
    if (branch.$ref !== undefined) continue
    const merged = mergeAllOfInto({ ...branch }, depth + 1)
    if (merged.properties) {
      for (const [k, v] of Object.entries(merged.properties)) {
        if (!(k in properties)) properties[k] = v
      }
    }
    if (merged.required) {
      for (const r of merged.required) required.add(r)
    }
    if (schema.description === undefined && merged.description !== undefined) {
      schema.description = merged.description
    }
    if (schema.xml === undefined && merged.xml !== undefined) {
      schema.xml = merged.xml
    }
    if (schema.discriminator === undefined && merged.discriminator !== undefined) {
      schema.discriminator = merged.discriminator
    }
  }
  if (Object.keys(properties).length > 0) schema.properties = properties
  if (required.size > 0) schema.required = Array.from(required)
  return schema
}

/** Pick out the names of the `$ref` branches under a composition
 * key (`oneOf` / `anyOf` / `allOf`). Inline (non-`$ref`) branches
 * are skipped — those don't have a stable name to link to in the
 * doc viewer. Returns `undefined` when nothing surfaces. */
export function extractCompositionRefs(branches: CommonSchema[] | undefined): string[] | undefined {
  if (!branches || branches.length === 0) return undefined
  const refs: string[] = []
  for (const branch of branches) {
    if (branch.$ref !== undefined) refs.push(refName(branch.$ref))
  }
  return refs.length > 0 ? refs : undefined
}

/** Normalise the schema's `discriminator` field to the common shape.
 * Swagger 2.0 carries it as a single string (the property name);
 * OpenAPI 3.x carries it as `{ propertyName, mapping }`. Returns
 * `undefined` when absent. */
export function extractDiscriminator(
  schema: CommonSchema
): { propertyName: string; mapping?: Record<string, string> } | undefined {
  const d = schema.discriminator
  if (d === undefined) return undefined
  if (typeof d === 'string') return { propertyName: d }
  if (typeof d === 'object' && typeof d.propertyName === 'string') {
    const out: { propertyName: string; mapping?: Record<string, string> } = { propertyName: d.propertyName }
    if (d.mapping !== undefined) {
      // Some specs put `#/components/schemas/Dog` in the mapping —
      // collapse to the trailing model name so it matches the
      // documentation models map exactly.
      const cleaned: Record<string, string> = {}
      for (const [k, v] of Object.entries(d.mapping)) {
        cleaned[k] = v.startsWith('#/') ? refName(v) : v
      }
      out.mapping = cleaned
    }
    return out
  }
  return undefined
}

/** Build a `ModelDocumentation`-shaped property list from a schema's `properties` map. */
export function mapSchemaProperties(schema: CommonSchema): PropertyDocumentation[] {
  const merged = mergeAllOfInto({ ...schema })
  const required = new Set(merged.required ?? [])
  const properties: PropertyDocumentation[] = []
  for (const [propName, propSchema] of Object.entries(merged.properties ?? {})) {
    const prop: PropertyDocumentation = {
      name: propName,
      type: schemaTypeLabel(propSchema),
      required: required.has(propName)
    }
    if (propSchema.format !== undefined) prop.format = propSchema.format
    if (propSchema.description !== undefined) prop.description = propSchema.description
    const ref = resolveModelRef(propSchema)
    if (ref !== undefined) {
      prop.targetModelRef = ref.ref
      if (ref.isArray) prop.isArrayOfRef = true
    }
    if (propSchema.nullable === true || propSchema['x-nullable'] === true || hasNullInTypeArray(propSchema)) {
      prop.nullable = true
    }
    if (propSchema.readOnly === true) prop.readOnly = true
    if (propSchema.example !== undefined) prop.example = propSchema.example
    if (propSchema.enum !== undefined && propSchema.enum.length > 0) prop.enumValues = propSchema.enum
    const constraints = extractSchemaConstraints(propSchema)
    if (constraints !== undefined) prop.constraints = constraints
    if (propSchema.xml !== undefined) {
      const xml: PropertyDocumentation['xml'] = {}
      if (propSchema.xml.name !== undefined) xml.name = propSchema.xml.name
      if (propSchema.xml.attribute !== undefined) xml.attribute = propSchema.xml.attribute
      if (propSchema.xml.wrapped !== undefined) xml.wrapped = propSchema.xml.wrapped
      if (propSchema.xml.prefix !== undefined) xml.prefix = propSchema.xml.prefix
      if (propSchema.xml.namespace !== undefined) xml.namespace = propSchema.xml.namespace
      if (Object.keys(xml).length > 0) prop.xml = xml
    }
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
