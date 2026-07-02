/**
 * RAML (RAML 1.0, best-effort 0.8) → ApiDocumentation transformer.
 *
 * `raml-1-parser` hands back a live AST (accessor methods, not plain
 * JSON) rather than a parsed spec object, so this transformer works
 * off a small duck-typed subset of that AST instead of the JSON-Schema
 * shapes the OpenAPI/Swagger family consumes directly. Every RAML type
 * declaration is first normalised into the shared `CommonSchema` shape
 * (`ramlTypeToCommonSchema`) so the rest of the pipeline reuses the
 * same `_shared.ts` helpers (property mapping, parameter mapping,
 * operation-row building) as every other importer.
 *
 * RAML custom type references (`type: Person`, `type: Person[]`) don't
 * carry a `$ref` — they're plain type names. They're synthesised into
 * `{ $ref: '#/types/<Name>' }` here so `resolveModelRef` /
 * `walkSchemaRefs` / `mapSchemaProperties` work unchanged.
 */

import type {
  ApiDocumentation,
  ModelDocumentation,
  OAuth2Flow,
  OperationDocumentation,
  SecurityScheme
} from '../../../../shared/types/apiDocumentation'
import {
  HTTP_METHODS,
  buildOperationDocumentation,
  mapSchemaProperties,
  type CommonParameter,
  type CommonResponse,
  type CommonSchema,
  type HttpMethod,
  type OperationDocumentationInput
} from './_shared'

// ────────────────────────────────────────────────────────────────────────────
// Minimal duck-typed subset of the raml-1-parser AST we read. Every
// accessor is optional because the RAML 0.8 artifact exposes a
// narrower surface than 1.0 — callers guard with `typeof x === 'function'`
// before calling anything beyond `name()` / `type()`.
// ────────────────────────────────────────────────────────────────────────────

interface RamlMarkdown { value(): string }

export interface RamlTypeNode {
  name(): string
  type?(): string[] | string
  required?(): boolean
  description?(): RamlMarkdown | null
  default?(): unknown
  enum?(): unknown[]
  example?(): { value(): unknown } | null
  properties?(): RamlTypeNode[]
  items?(): RamlTypeNode[]
  pattern?(): string | null
  minLength?(): number | null
  maxLength?(): number | null
  minimum?(): number | null
  maximum?(): number | null
}

export interface RamlResponseNode {
  code(): { value(): string }
  headers(): RamlTypeNode[]
  body(): RamlTypeNode[]
  description?(): RamlMarkdown | null
}

export interface RamlMethodNode {
  method(): string
  displayName?(): string
  description?(): RamlMarkdown | null
  queryParameters(): RamlTypeNode[]
  headers(): RamlTypeNode[]
  body(): RamlTypeNode[]
  responses(): RamlResponseNode[]
  securedBy?(): { securitySchemeName(): string }[]
}

export interface RamlResourceNode {
  relativeUri(): { value(): string }
  displayName?(): string
  description?(): RamlMarkdown | null
  completeRelativeUri(): string
  uriParameters?(): RamlTypeNode[]
  methods(): RamlMethodNode[]
  resources(): RamlResourceNode[]
  securedBy?(): { securitySchemeName(): string }[]
}

export interface RamlSecuritySchemeSettingsNode {
  accessTokenUri?(): { value(): string } | null
  authorizationUri?(): { value(): string } | null
  authorizationGrants?(): string[] | null
  scopes?(): string[] | null
}

export interface RamlSecuritySchemeNode {
  name(): string
  type(): string
  description?(): RamlMarkdown | null
  settings?(): RamlSecuritySchemeSettingsNode | null
}

export interface RamlApi {
  RAMLVersion(): string
  title(): string
  description?(): RamlMarkdown | null
  version?(): string | null
  baseUri(): { value(): string }
  resources(): RamlResourceNode[]
  types?(): RamlTypeNode[]
  securitySchemes?(): RamlSecuritySchemeNode[]
  securedBy?(): { securitySchemeName(): string }[]
  expand(expandLibraries?: boolean): RamlApi
}

// ────────────────────────────────────────────────────────────────────────────
// RAML type declaration → CommonSchema
// ────────────────────────────────────────────────────────────────────────────

const RAML_SCALAR_TYPES: Record<string, { type: string; format?: string }> = {
  string: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  'date-only': { type: 'string', format: 'date' },
  'time-only': { type: 'string', format: 'time' },
  'datetime-only': { type: 'string', format: 'date-time' },
  datetime: { type: 'string', format: 'date-time' },
  file: { type: 'string', format: 'binary' },
  nil: { type: 'null' }
}

function firstTypeName(node: Pick<RamlTypeNode, 'type'>): string {
  const raw = node.type ? node.type() : undefined
  const list = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : []
  return list[0] ?? 'any'
}

/** `{ type: 'Foo' }` (scalar) or `{ $ref: '#/types/Foo' }` (custom type). */
function scalarOrRef(name: string): CommonSchema {
  const scalar = RAML_SCALAR_TYPES[name]
  return scalar !== undefined ? { type: scalar.type, ...(scalar.format !== undefined ? { format: scalar.format } : {}) } : { $ref: `#/types/${name}` }
}

/** Copy the facets every RAML type declaration may carry (enum, default,
 * description, example, string/number constraints) onto a `CommonSchema`.
 * Every accessor is probed with `typeof === 'function'` first — RAML 0.8
 * nodes and non-matching subtypes (e.g. `minLength` on an integer) don't
 * expose facets that don't apply to their kind. */
function attachCommonFacets(schema: CommonSchema, node: RamlTypeNode): void {
  if (typeof node.enum === 'function') {
    const values = node.enum()
    if (Array.isArray(values) && values.length > 0) schema.enum = values
  }
  if (typeof node.default === 'function') {
    const value = node.default()
    if (value !== undefined && value !== null) schema.default = value
  }
  if (typeof node.pattern === 'function') {
    const value = node.pattern()
    if (value != null) schema.pattern = value
  }
  if (typeof node.minLength === 'function') {
    const value = node.minLength()
    if (value != null) schema.minLength = value
  }
  if (typeof node.maxLength === 'function') {
    const value = node.maxLength()
    if (value != null) schema.maxLength = value
  }
  if (typeof node.minimum === 'function') {
    const value = node.minimum()
    if (value != null) schema.minimum = value
  }
  if (typeof node.maximum === 'function') {
    const value = node.maximum()
    if (value != null) schema.maximum = value
  }
  if (typeof node.description === 'function') {
    const description = node.description()
    if (description != null) schema.description = description.value()
  }
  if (typeof node.example === 'function') {
    const example = node.example()
    if (example != null) schema.example = example.value()
  }
}

/**
 * Convert a RAML type declaration (a root `types:` entry, a property, a
 * parameter, or a body/response media-type node) into `CommonSchema`.
 * Recognises the three shapes RAML uses for arrays: the `Foo[]` shorthand,
 * an explicit `type: array` + `items:` declaration, and falls back to a
 * named-type `$ref` for anything that isn't a RAML built-in scalar/object/
 * array keyword.
 */
export function ramlTypeToCommonSchema(node: RamlTypeNode): CommonSchema {
  const raw = firstTypeName(node)

  const arrayShorthand = /^(.+)\[\]$/.exec(raw)
  if (arrayShorthand?.[1] !== undefined) {
    return { type: 'array', items: scalarOrRef(arrayShorthand[1]) }
  }

  if (raw === 'array') {
    const items = typeof node.items === 'function' ? node.items() : []
    const schema: CommonSchema = { type: 'array', items: items[0] ? ramlTypeToCommonSchema(items[0]) : { type: 'string' } }
    attachCommonFacets(schema, node)
    return schema
  }

  if (raw === 'object') {
    const schema: CommonSchema = { type: 'object' }
    const props = typeof node.properties === 'function' ? node.properties() : []
    if (props.length > 0) {
      const properties: Record<string, CommonSchema> = {}
      const required: string[] = []
      for (const prop of props) {
        properties[prop.name()] = ramlTypeToCommonSchema(prop)
        // RAML properties are required by default (`required()` returns
        // `true` unless the spec sets `required: false`).
        if (typeof prop.required !== 'function' || prop.required()) required.push(prop.name())
      }
      schema.properties = properties
      if (required.length > 0) schema.required = required
    }
    attachCommonFacets(schema, node)
    return schema
  }

  const scalar = RAML_SCALAR_TYPES[raw]
  if (scalar !== undefined) {
    const schema: CommonSchema = { type: scalar.type }
    if (scalar.format !== undefined) schema.format = scalar.format
    attachCommonFacets(schema, node)
    return schema
  }

  if (raw === 'any' || raw === 'union') {
    const schema: CommonSchema = {}
    attachCommonFacets(schema, node)
    return schema
  }

  // A bare custom type name (`Person`) — synthesise a `$ref` so the
  // shared model-graph helpers (`resolveModelRef`, `walkSchemaRefs`) see
  // it the same way they see an OpenAPI/Swagger `$ref`.
  return scalarOrRef(raw)
}

// ────────────────────────────────────────────────────────────────────────────
// Parameters / responses / models
// ────────────────────────────────────────────────────────────────────────────

function toCommonParameter(node: RamlTypeNode, location: string): CommonParameter {
  const schema = ramlTypeToCommonSchema(node)
  const out: CommonParameter = { name: node.name(), in: location, schema }
  if (typeof node.required === 'function') out.required = node.required()
  if (schema.description !== undefined) out.description = schema.description
  if (schema.default !== undefined) out.default = schema.default
  if (schema.example !== undefined) out.example = schema.example
  return out
}

function toCommonResponses(responses: RamlResponseNode[]): Record<string, CommonResponse> {
  const out: Record<string, CommonResponse> = {}
  for (const response of responses) {
    const entry: CommonResponse = {}
    const description = typeof response.description === 'function' ? response.description() : null
    if (description != null) entry.description = description.value()
    // A RAML response body is keyed by media type; pick the first
    // declared one (mirrors the OpenAPI/Swagger transformers, which
    // also collapse multi-content-type responses to one entry).
    const body = response.body()[0]
    if (body !== undefined) entry.schema = ramlTypeToCommonSchema(body)
    out[response.code().value()] = entry
  }
  return out
}

/** Build the `ApiDocumentation.models` map from the API's root `types:` declarations. */
function mapModels(types: RamlTypeNode[]): Record<string, ModelDocumentation> {
  const out: Record<string, ModelDocumentation> = {}
  for (const typeNode of types) {
    const schema = ramlTypeToCommonSchema(typeNode)
    const entry: ModelDocumentation = { name: typeNode.name(), properties: mapSchemaProperties(schema) }
    if (schema.description !== undefined) entry.description = schema.description
    if (Array.isArray(schema.enum) && schema.enum.length > 0) entry.enumValues = [...schema.enum]
    out[typeNode.name()] = entry
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Security schemes — best-effort per the ticket note: OAuth2 / Basic map to
// Restorm's `SecurityScheme` shape (and drive header pre-wiring in
// `RamlImportService`); every other scheme type (Digest, Pass Through,
// OAuth 1.0, custom `x-*` schemes) is still recorded here for the docs
// viewer but doesn't pre-wire a header.
// ────────────────────────────────────────────────────────────────────────────

/** RAML's OAuth2 grant vocabulary (`authorization_code`, `password`,
 * `client_credentials`, `implicit`) mapped onto the Swagger-2.0-derived
 * vocabulary `OAuth2Flow.type` already uses everywhere else in the app. */
const RAML_GRANT_TO_FLOW_TYPE: Record<string, OAuth2Flow['type']> = {
  implicit: 'implicit',
  password: 'password',
  client_credentials: 'application',
  authorization_code: 'accessCode'
}

function mapSecuritySchemes(schemes: RamlSecuritySchemeNode[]): Record<string, SecurityScheme> | undefined {
  if (schemes.length === 0) return undefined
  const out: Record<string, SecurityScheme> = {}
  for (const scheme of schemes) {
    const description = typeof scheme.description === 'function' ? scheme.description() : null
    if (scheme.type() === 'Basic Authentication') {
      const entry: SecurityScheme = { type: 'http', scheme: 'basic' }
      if (description != null) entry.description = description.value()
      out[scheme.name()] = entry
    } else if (scheme.type() === 'OAuth 2.0') {
      const settings = typeof scheme.settings === 'function' ? scheme.settings() : null
      const grants = (settings?.authorizationGrants?.() ?? [])
      const flowType = RAML_GRANT_TO_FLOW_TYPE[grants[0] ?? ''] ?? 'implicit'
      const flow: OAuth2Flow = { type: flowType, scopes: {} }
      const authUrl = settings?.authorizationUri?.()
      if (authUrl != null) flow.authorizationUrl = authUrl.value()
      const tokenUrl = settings?.accessTokenUri?.()
      if (tokenUrl != null) flow.tokenUrl = tokenUrl.value()
      for (const scope of settings?.scopes?.() ?? []) flow.scopes[scope] = scope
      const entry: SecurityScheme = { type: 'oauth2', flows: [flow] }
      if (description != null) entry.description = description.value()
      out[scheme.name()] = entry
    } else {
      // Digest / Pass Through / OAuth 1.0 / custom `x-*` schemes:
      // documentation-only, per the ticket's known-limitations note.
      const entry: SecurityScheme = { type: 'http', scheme: scheme.type() }
      if (description != null) entry.description = description.value()
      out[scheme.name()] = entry
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Resource tree walk → operations
// ────────────────────────────────────────────────────────────────────────────

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value)
}

function walkResource(resource: RamlResourceNode, operations: OperationDocumentation[]): void {
  const path = resource.completeRelativeUri()
  const group = path.split('/').find((segment) => segment.length > 0)
  for (const method of resource.methods()) {
    const verb = method.method()
    if (!isHttpMethod(verb)) continue

    const parameters: CommonParameter[] = [
      ...method.queryParameters().map((p) => toCommonParameter(p, 'query')),
      ...method.headers().map((p) => toCommonParameter(p, 'header')),
      ...(typeof resource.uriParameters === 'function' ? resource.uriParameters() : []).map((p) => toCommonParameter(p, 'path'))
    ]

    const input: OperationDocumentationInput = {
      path,
      method: verb,
      parameters,
      responses: toCommonResponses(method.responses())
    }
    if (group !== undefined) input.tags = [group]
    const description = typeof method.description === 'function' ? method.description() : null
    if (description != null) input.description = description.value()
    if (typeof method.displayName === 'function' && method.displayName()) input.summary = method.displayName()
    const requestBody = method.body()[0]
    if (requestBody !== undefined) {
      const bodySchema = ramlTypeToCommonSchema(requestBody)
      input.referencedModels = bodySchema.$ref !== undefined ? [bodySchema.$ref.split('/').pop() ?? ''] : []
    }
    const securedBy = typeof method.securedBy === 'function' ? method.securedBy() : (typeof resource.securedBy === 'function' ? resource.securedBy() : [])
    if (securedBy.length > 0) {
      input.security = securedBy.map((ref) => ({ [ref.securitySchemeName()]: [] }))
    }

    operations.push(buildOperationDocumentation(input))
  }

  for (const child of resource.resources()) walkResource(child, operations)
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

export interface RamlTransformOptions {
  /** URL the spec was fetched from (if any) — becomes `ApiDocumentation.sourceUrl`. */
  sourceUrl?: string
}

export function ramlToApiDocumentation(api: RamlApi, options: RamlTransformOptions = {}): ApiDocumentation {
  const operations: OperationDocumentation[] = []
  for (const resource of api.resources()) walkResource(resource, operations)

  const result: ApiDocumentation = {
    sourceType: 'raml',
    api: { title: api.title() },
    models: mapModels(typeof api.types === 'function' ? api.types() : []),
    groups: {},
    operations
  }

  const description = typeof api.description === 'function' ? api.description() : null
  if (description != null) result.api.description = description.value()
  const version = typeof api.version === 'function' ? api.version() : null
  if (version != null && version !== '') result.api.version = version

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  const securitySchemes = mapSecuritySchemes(typeof api.securitySchemes === 'function' ? api.securitySchemes() : [])
  if (securitySchemes !== undefined) result.securitySchemes = securitySchemes

  return result
}
