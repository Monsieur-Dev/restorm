/**
 * OpenAPI 3.0 → ApiDocumentation transformer.
 *
 * Reads a parsed OpenAPI 3.0 spec and produces the common ApiDocumentation
 * structure stored on the root EnvironmentFolder after import. The renderer's
 * `DocumentationHost` consumes that tree directly — no markdown compilation
 * step.
 *
 * Layered on top of `_shared.ts`: this file owns 3.0-specific normalisation
 * (servers, requestBody, multi-content-type responses, components/schemas,
 * security schemes), then hands a normalised operation shape to the shared
 * `buildOperationDocumentation` helper.
 */

import type {
  ApiDocumentation,
  ExternalDocs,
  ModelDocumentation,
  OAuth2Flow,
  OperationDocumentation,
  SecurityScheme
} from '../../../../shared/types/apiDocumentation'
import {
  HTTP_METHODS,
  buildApiInfo,
  buildOperationDocumentation,
  mapSchemaProperties,
  mapTagsToGroups,
  refName,
  walkSchemaRefs,
  type CommonInfo,
  type CommonParameter,
  type CommonResponse,
  type CommonSchema,
  type CommonTag,
  type HttpMethod,
  type OperationDocumentationInput
} from './_shared'

// ────────────────────────────────────────────────────────────────────────────
// OpenAPI 3.0 source-spec types — minimal subset we actually consume.
// ────────────────────────────────────────────────────────────────────────────

interface OAS3Reference {
  $ref: string
}

function isReference(value: unknown): value is OAS3Reference {
  return typeof value === 'object' && value !== null && '$ref' in value && typeof (value as { $ref: unknown }).$ref === 'string'
}

export interface OAS3ServerVariable {
  /** Spec marks this required, but real-world JSON sometimes omits it; treat as optional. */
  default?: string
  enum?: string[]
  description?: string
}

export interface OAS3Server {
  url: string
  description?: string
  variables?: Record<string, OAS3ServerVariable>
}

interface OAS3MediaType {
  schema?: CommonSchema | OAS3Reference
  example?: unknown
  examples?: Record<string, unknown>
}

interface OAS3RequestBody {
  description?: string
  content: Record<string, OAS3MediaType>
  required?: boolean
}

interface OAS3Response {
  description?: string
  headers?: Record<string, OAS3Reference | { description?: string; schema?: CommonSchema | OAS3Reference }>
  content?: Record<string, OAS3MediaType>
}

interface OAS3Parameter {
  name: string
  in: string
  description?: string
  required?: boolean
  schema?: CommonSchema | OAS3Reference
  example?: unknown
  examples?: Record<string, unknown>
  /** OAS 3.0 — content-keyed parameter (rare). The first entry's schema wins. */
  content?: Record<string, OAS3MediaType>
}

export interface OAS3Operation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: (OAS3Parameter | OAS3Reference)[]
  requestBody?: OAS3RequestBody | OAS3Reference
  responses?: Record<string, OAS3Response | OAS3Reference>
  security?: Record<string, string[]>[]
  deprecated?: boolean
  externalDocs?: ExternalDocs
  callbacks?: Record<string, unknown>
  servers?: OAS3Server[]
}

export type OAS3PathItem = Partial<Record<HttpMethod, OAS3Operation>> & {
  parameters?: (OAS3Parameter | OAS3Reference)[]
  servers?: OAS3Server[]
  summary?: string
  description?: string
}

/** OpenAPI 3.x security scheme entry. The `flows` block uses 3.x
 * vocabulary (`clientCredentials` / `authorizationCode`); the
 * normaliser maps those onto Swagger 2.0's flow keys
 * (`application` / `accessCode`) so the doc viewer's rendering
 * doesn't have to special-case the version. */
interface OAS3SecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  description?: string
  // apiKey
  name?: string
  in?: 'header' | 'query' | 'cookie'
  // http
  scheme?: string
  bearerFormat?: string
  // oauth2
  flows?: {
    implicit?: OAS3OAuthFlow
    password?: OAS3OAuthFlow
    clientCredentials?: OAS3OAuthFlow
    authorizationCode?: OAS3OAuthFlow
  }
  // openIdConnect
  openIdConnectUrl?: string
}

interface OAS3OAuthFlow {
  authorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes?: Record<string, string>
}

export interface OAS3Components {
  schemas?: Record<string, CommonSchema>
  parameters?: Record<string, OAS3Parameter>
  requestBodies?: Record<string, OAS3RequestBody>
  responses?: Record<string, OAS3Response>
  headers?: Record<string, unknown>
  examples?: Record<string, unknown>
  links?: Record<string, unknown>
  callbacks?: Record<string, unknown>
  securitySchemes?: Record<string, OAS3SecurityScheme>
}

export interface OAS3Spec {
  openapi: string
  info: CommonInfo
  servers?: OAS3Server[]
  paths: Record<string, OAS3PathItem>
  webhooks?: Record<string, OAS3PathItem>          // 3.1 only — passed through here for 3.1 reuse.
  components?: OAS3Components
  tags?: CommonTag[]
  externalDocs?: ExternalDocs
  security?: Record<string, string[]>[]
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — version-specific normalisation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pick the "primary" media type from a 3.x `content` map. JSON wins; falling
 * back to the first declared content type otherwise. This mirrors what the
 * importer-side `OpenAPIImportService` does when materialising the body, so
 * the docs and the prefilled request stay aligned.
 */
export function pickPrimaryContentType(content: Record<string, OAS3MediaType> | undefined): string | undefined {
  if (!content) return undefined
  const keys = Object.keys(content)
  if (keys.length === 0) return undefined
  const json = keys.find((k) => k === 'application/json' || /^application\/[\w.+-]*\bjson\b/.test(k))
  return json ?? keys[0]
}

/** Resolve a `(value | $ref)` spot to a value, dereferenced once via the spec components.
 * Stays version-aware — components live under `#/components/<bucket>` in 3.x.
 */
function deref<T>(spec: OAS3Spec, value: T | OAS3Reference, bucket: keyof OAS3Components): T | undefined {
  if (!isReference(value)) return value
  const componentName = refName(value.$ref)
  const components = spec.components?.[bucket]
  if (!components) return undefined
  const candidate = (components as Record<string, T>)[componentName]
  return candidate
}

/** Flatten a parameter list, dereferencing `parameters[]` entries that are `$ref`s. */
function resolveParameters(spec: OAS3Spec, params: (OAS3Parameter | OAS3Reference)[] | undefined): OAS3Parameter[] {
  if (!params) return []
  const out: OAS3Parameter[] = []
  for (const p of params) {
    const resolved = deref(spec, p, 'parameters')
    if (resolved) out.push(resolved)
  }
  return out
}

/** Convert an OAS 3.x parameter to the version-agnostic shape `_shared` understands. */
export function toCommonParameter(spec: OAS3Spec, p: OAS3Parameter): CommonParameter {
  let schema: CommonSchema | undefined
  if (p.schema) {
    schema = isReference(p.schema)
      ? { $ref: p.schema.$ref }
      : p.schema
  } else if (p.content) {
    // Content-typed parameter (rare): use the primary content's schema.
    const primary = pickPrimaryContentType(p.content)
    const media = primary !== undefined ? p.content[primary] : undefined
    if (media?.schema) {
      schema = isReference(media.schema) ? { $ref: media.schema.$ref } : media.schema
    }
  }
  const out: CommonParameter = {
    name: p.name,
    in: p.in
  }
  if (p.description !== undefined) out.description = p.description
  if (p.required !== undefined) out.required = p.required
  if (schema) out.schema = schema
  if (p.example !== undefined) out.example = p.example
  return out
}

/** Build the `responses` map in the shape `_shared` expects. Multi-content-type
 * responses are collapsed to the primary content's schema (JSON-first). */
function buildCommonResponses(spec: OAS3Spec, responses: Record<string, OAS3Response | OAS3Reference> | undefined): Record<string, CommonResponse> | undefined {
  if (!responses) return undefined
  const out: Record<string, CommonResponse> = {}
  for (const [code, raw] of Object.entries(responses)) {
    const resolved = deref(spec, raw, 'responses')
    if (!resolved) continue
    const entry: CommonResponse = {}
    if (resolved.description !== undefined) entry.description = resolved.description
    const primary = pickPrimaryContentType(resolved.content)
    if (primary !== undefined && resolved.content) {
      const media = resolved.content[primary]
      if (media?.schema) {
        entry.schema = isReference(media.schema) ? { $ref: media.schema.$ref } : media.schema
      }
    }
    if (resolved.headers) {
      const headers: Record<string, { type: string; description?: string }> = {}
      for (const [name, hdr] of Object.entries(resolved.headers)) {
        if (isReference(hdr)) {
          headers[name] = { type: refName(hdr.$ref) }
        } else {
          const headerSchema = hdr.schema && !isReference(hdr.schema) ? hdr.schema : undefined
          const type = headerSchema?.type
          headers[name] = {
            type: typeof type === 'string' ? type : Array.isArray(type) ? (type[0] ?? 'string') : 'string',
            ...(hdr.description !== undefined ? { description: hdr.description } : {})
          }
        }
      }
      entry.headers = headers
    }
    out[code] = entry
  }
  return out
}

/** Synthesize a virtual body parameter for the documentation row when the
 * operation declares a `requestBody`. Mirrors how Swagger 2.0 surfaces an
 * `in: body` parameter. */
function bodyToCommonParameter(spec: OAS3Spec, body: OAS3RequestBody | OAS3Reference): CommonParameter | undefined {
  const resolved = deref(spec, body, 'requestBodies')
  if (!resolved) return undefined
  const primary = pickPrimaryContentType(resolved.content)
  let schema: CommonSchema | undefined
  if (primary !== undefined && resolved.content[primary]?.schema) {
    const raw = resolved.content[primary].schema
    schema = isReference(raw) ? { $ref: raw.$ref } : raw
  }
  const param: CommonParameter = {
    name: 'body',
    in: 'body',
    required: resolved.required ?? false
  }
  if (resolved.description !== undefined) param.description = resolved.description
  if (schema) param.schema = schema
  return param
}

/** Walk every schema reachable from an operation and collect referenced model names. */
function collectReferencedModels(spec: OAS3Spec, op: OAS3Operation): string[] {
  const refs = new Set<string>()
  const visit = (name: string): void => { refs.add(name) }
  for (const raw of op.parameters ?? []) {
    const param = deref(spec, raw, 'parameters')
    if (!param) continue
    if (param.schema) {
      walkSchemaRefs(isReference(param.schema) ? { $ref: param.schema.$ref } : param.schema, visit)
    }
  }
  if (op.requestBody) {
    const body = deref(spec, op.requestBody, 'requestBodies')
    if (body) {
      for (const media of Object.values(body.content)) {
        if (media.schema) {
          walkSchemaRefs(isReference(media.schema) ? { $ref: media.schema.$ref } : media.schema, visit)
        }
      }
    }
  }
  for (const raw of Object.values(op.responses ?? {})) {
    const resp = deref(spec, raw, 'responses')
    if (!resp?.content) continue
    for (const media of Object.values(resp.content)) {
      if (media.schema) {
        walkSchemaRefs(isReference(media.schema) ? { $ref: media.schema.$ref } : media.schema, visit)
      }
    }
  }
  return Array.from(refs)
}

/** Map `components.schemas` onto the doc layer. Same one-row-per-model shape
 * the 2.0 transformer produces from `definitions`. */
function mapModels(components: OAS3Components | undefined): Record<string, ModelDocumentation> {
  const schemas = components?.schemas
  if (!schemas) return {}
  const out: Record<string, ModelDocumentation> = {}
  for (const [name, schema] of Object.entries(schemas)) {
    const entry: ModelDocumentation = { name, properties: mapSchemaProperties(schema) }
    if (schema.description !== undefined) entry.description = schema.description
    out[name] = entry
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Operations — reachable from `paths` and (3.1 only) `webhooks`.
// ────────────────────────────────────────────────────────────────────────────

/** Build the full operation list from a path-item map. Tags shared by every
 * operation under a path-item are NOT propagated — each operation must
 * declare its own (matches OpenAPI 3.x semantics). */
function buildOperationsFromMap(
  spec: OAS3Spec,
  pathMap: Record<string, OAS3PathItem>,
  /** Adds the given marker to each operation's `extra`. Used for the
   * documentation-only marker on the 3.1 `webhooks` block. */
  extraMarker?: Record<string, unknown>
): OperationDocumentation[] {
  const out: OperationDocumentation[] = []
  for (const [path, pathItem] of Object.entries(pathMap)) {
    const sharedParams = resolveParameters(spec, pathItem.parameters)
    for (const method of HTTP_METHODS) {
      const op = pathItem[method]
      if (!op) continue
      const opParams = resolveParameters(spec, op.parameters)
      // Path-item-scoped params are inherited by every operation unless
      // the operation overrides them (by `(name, in)` pair).
      const merged: OAS3Parameter[] = [
        ...sharedParams.filter((sp) => !opParams.some((op2) => op2.name === sp.name && op2.in === sp.in)),
        ...opParams
      ]

      const commonParams: CommonParameter[] = merged.map((p) => toCommonParameter(spec, p))
      if (op.requestBody) {
        const bodyParam = bodyToCommonParameter(spec, op.requestBody)
        if (bodyParam) commonParams.push(bodyParam)
      }

      const input: OperationDocumentationInput = {
        path,
        method,
        parameters: commonParams.length > 0 ? commonParams : undefined,
        responses: buildCommonResponses(spec, op.responses),
        referencedModels: collectReferencedModels(spec, op),
        extra: extraMarker ? { ...extraMarker } : undefined
      }
      if (op.tags !== undefined) input.tags = op.tags
      if (op.summary !== undefined) input.summary = op.summary
      if (op.description !== undefined) input.description = op.description
      if (op.operationId !== undefined) input.operationId = op.operationId
      if (op.deprecated) input.deprecated = true
      if (op.externalDocs !== undefined) input.externalDocs = op.externalDocs
      if (op.security !== undefined) input.security = op.security

      // 3.x has per-operation `consumes`/`produces` derived from request/response
      // content keys. Surfaced for parity with the 2.0 doc.
      const consumes = op.requestBody && !isReference(op.requestBody)
        ? Object.keys(op.requestBody.content)
        : undefined
      if (consumes && consumes.length > 0) input.consumes = consumes
      const produces = new Set<string>()
      for (const raw of Object.values(op.responses ?? {})) {
        const resp = deref(spec, raw, 'responses')
        if (resp?.content) for (const k of Object.keys(resp.content)) produces.add(k)
      }
      if (produces.size > 0) input.produces = Array.from(produces)

      out.push(buildOperationDocumentation(input))
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

export interface OpenAPI3TransformOptions {
  /** URL the spec was fetched from, for `ApiDocumentation.sourceUrl`. */
  sourceUrl?: string
}

/** Transform a parsed OpenAPI 3.0 spec into `ApiDocumentation`. */
/**
 * Translate OpenAPI 3.x `components.securitySchemes` to the
 * version-neutral `SecurityScheme` shape stored on
 * `ApiDocumentation`. The 3.x flow vocabulary
 * (`clientCredentials` / `authorizationCode`) is mapped onto the
 * Swagger 2.0 names (`application` / `accessCode`) so the doc
 * viewer's rendering is uniform across spec versions.
 */
function mapSecuritySchemes(
  defs: Record<string, OAS3SecurityScheme> | undefined
): Record<string, SecurityScheme> | undefined {
  if (!defs) return undefined
  const out: Record<string, SecurityScheme> = {}
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'apiKey') {
      const entry: SecurityScheme = { type: 'apiKey' }
      if (def.description !== undefined) entry.description = def.description
      if (def.name !== undefined) entry.name = def.name
      if (def.in !== undefined) entry.in = def.in
      out[name] = entry
    } else if (def.type === 'http') {
      const entry: SecurityScheme = { type: 'http' }
      if (def.description !== undefined) entry.description = def.description
      if (def.scheme !== undefined) entry.scheme = def.scheme
      if (def.bearerFormat !== undefined) entry.bearerFormat = def.bearerFormat
      out[name] = entry
    } else if (def.type === 'oauth2') {
      const entry: SecurityScheme = { type: 'oauth2' }
      if (def.description !== undefined) entry.description = def.description
      const flows: OAuth2Flow[] = []
      const flowMap: { key: keyof Required<OAS3SecurityScheme>['flows']; type: OAuth2Flow['type'] }[] = [
        { key: 'implicit', type: 'implicit' },
        { key: 'password', type: 'password' },
        { key: 'clientCredentials', type: 'application' },
        { key: 'authorizationCode', type: 'accessCode' }
      ]
      for (const { key, type } of flowMap) {
        const f = def.flows?.[key]
        if (!f) continue
        const flow: OAuth2Flow = { type, scopes: f.scopes ?? {} }
        if (f.authorizationUrl !== undefined) flow.authorizationUrl = f.authorizationUrl
        if (f.tokenUrl !== undefined) flow.tokenUrl = f.tokenUrl
        if (f.refreshUrl !== undefined) flow.refreshUrl = f.refreshUrl
        flows.push(flow)
      }
      if (flows.length > 0) entry.flows = flows
      out[name] = entry
    } else {
      // def.type === 'openIdConnect' (only remaining branch).
      const entry: SecurityScheme = { type: 'openIdConnect' }
      if (def.description !== undefined) entry.description = def.description
      if (def.openIdConnectUrl !== undefined) entry.openIdConnectUrl = def.openIdConnectUrl
      out[name] = entry
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function openapi3ToApiDocumentation(
  spec: OAS3Spec,
  options: OpenAPI3TransformOptions = {}
): ApiDocumentation {
  const operations = buildOperationsFromMap(spec, spec.paths)

  // 3.1 webhooks — present only on 3.1 specs but the 3.0 transformer happily
  // ignores it when absent. The 3.1 thin shim relies on this passthrough.
  if (spec.webhooks) {
    operations.push(...buildOperationsFromMap(spec, spec.webhooks, { documentationOnly: true, source: 'webhook' }))
  }

  const result: ApiDocumentation = {
    sourceType: 'openapi',
    api: buildApiInfo(spec.info, spec.externalDocs),
    models: mapModels(spec.components),
    groups: mapTagsToGroups(spec.tags),
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  // `server` block reflects the *first* server entry. Multi-server fixtures
  // surface the full list to the import service so it can produce one
  // sub-environment per server; here we just record the primary for the docs.
  const primaryServer = spec.servers?.[0]
  if (primaryServer) {
    try {
      const expanded = expandServerVariables(primaryServer)
      const url = new URL(expanded)
      const schemes = url.protocol ? [url.protocol.replace(/:$/, '')] : undefined
      result.server = {
        ...(url.host ? { host: url.host } : {}),
        ...(url.pathname && url.pathname !== '/' ? { basePath: url.pathname } : {}),
        ...(schemes ? { schemes } : {})
      }
    } catch {
      // The server URL might be relative or contain unresolved variables —
      // skip gracefully rather than fail the whole import.
    }
  }

  const securitySchemes = mapSecuritySchemes(spec.components?.securitySchemes)
  if (securitySchemes !== undefined) result.securitySchemes = securitySchemes
  if (spec.security !== undefined) result.defaultSecurity = spec.security

  return result
}

/**
 * Replace `{var}` placeholders in a server URL with the variable's `default`
 * (or first `enum` value, falling back to `''`). Returns the original string
 * unchanged when there's nothing to substitute. Used by the metadata layer to
 * derive a "best-effort" host/basePath; the import service has its own copy
 * for materialising environments.
 */
export function expandServerVariables(server: OAS3Server): string {
  if (!server.variables) return server.url
  let out: string = server.url
  for (const [name, def] of Object.entries(server.variables)) {
    const replacement: string = def.default ?? def.enum?.[0] ?? ''
    // Escape regex specials in `name` so URL templates with literal regex
    // characters don't blow up.
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\{${safeName}\\}`, 'g'), replacement)
  }
  return out
}
