import type { ApiDocumentation, OperationDocumentation, ParameterDocumentation, ModelDocumentation, PropertyDocumentation } from '../../../shared/types/apiDocumentation'
import type { Environment } from '../../../shared/types/baseTypes'
import type { HTTPRequest, HTTPMethod, KeyValue, ValueType } from '../../../shared/types/collections'
import type { HTTPRequestBody } from '../../../shared/types/requestPrimitives'
import { StringValue, NumericValue, DateTimeValue, SecretValue } from '../../../shared/types/collections'
import { extractModelRef } from '../components/documentation/documentationModels'

const SUPPORTED_HTTP_METHODS: HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function toHTTPMethod(raw: string | undefined): HTTPMethod {
  if (raw === undefined) return 'GET'
  const upper = raw.toUpperCase()
  return SUPPORTED_HTTP_METHODS.find((m) => m === upper) ?? 'GET'
}

function exampleToString(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return '' }
}

/**
 * Map a documented parameter/property `type` (+ `format`) to a real
 * `ValueType`, mirroring the import path's `buildTypedValue`
 * (`OpenAPIImportService`). Without this every field lands as a `StringValue`,
 * so an `integer` path param like `petId` shows as text instead of a number —
 * the exact drift the docs-created request must not have vs a normal import.
 */
function typedValueFromDoc(type: string | undefined, format: string | undefined, defaultValue: string): ValueType {
  switch (type) {
    case 'integer':
    case 'number': {
      const num = defaultValue !== '' ? Number(defaultValue) : 0
      return new NumericValue(Number.isFinite(num) ? num : 0, 'decimal')
    }
    case 'string':
      if (format === 'date' || format === 'date-time') {
        return new DateTimeValue(new Date(), format === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss')
      }
      if (format === 'password') return new SecretValue('envFileSecret', {})
      return new StringValue(defaultValue)
    // `boolean` stays a StringValue('true'/'false') exactly as the import does
    // (the KV table has no dedicated boolean control for header/query values).
    default:
      return new StringValue(defaultValue)
  }
}

function paramToKeyValue(p: ParameterDocumentation): KeyValue {
  const initialValue = p.defaultValue ?? exampleToString(p.example)
  return {
    key: p.name,
    value: typedValueFromDoc(p.type, p.format, initialValue),
    enabled: p.required,
    description: p.description ?? ''
  }
}

/** A sample JS value for one documented property: a nested object/array when it
 * points at another model, its `example` when present, else a type-appropriate
 * placeholder. `seen` breaks cyclic model graphs. */
function sampleForProperty(
  prop: PropertyDocumentation,
  models: Map<string, ModelDocumentation>,
  seen: Set<string>
): unknown {
  if (prop.targetModelRef !== undefined) {
    const nested = sampleFromModel(prop.targetModelRef, models, seen)
    return prop.isArrayOfRef === true ? [nested] : nested
  }
  if (prop.example !== undefined) return prop.example
  if (Array.isArray(prop.enumValues) && prop.enumValues.length > 0) return prop.enumValues[0]
  const ref = extractModelRef(prop.type)
  if (ref.ref !== undefined && models.has(ref.ref)) {
    const nested = sampleFromModel(ref.ref, models, seen)
    return ref.isArray ? [nested] : nested
  }
  switch (prop.type) {
    case 'integer':
    case 'number': return 0
    case 'boolean': return false
    case 'array': return []
    case 'object': return {}
    default: return ''
  }
}

/** Build a sample object from a documented model, resolving nested model refs.
 * Returns `{}` for an unknown model or one already being expanded (cycle). */
function sampleFromModel(
  modelRef: string,
  models: Map<string, ModelDocumentation>,
  seen: Set<string>
): Record<string, unknown> {
  const model = models.get(modelRef)
  if (model === undefined || seen.has(modelRef)) return {}
  const nextSeen = new Set(seen).add(modelRef)
  const out: Record<string, unknown> = {}
  for (const prop of model.properties) {
    out[prop.name] = sampleForProperty(prop, models, nextSeen)
  }
  return out
}

/** Build the request body from the operation's `in:'body'` parameter, mirroring
 * the import: a JSON sample generated from the referenced model (or the body
 * param's own example). Returns undefined when the operation carries no body. */
function bodyFromOperation(
  operation: OperationDocumentation,
  models: Map<string, ModelDocumentation>
): HTTPRequestBody | undefined {
  const bodyParam = (operation.parameters ?? []).find((p) => p.location === 'body')
  if (bodyParam === undefined) return undefined
  if (bodyParam.example !== undefined) {
    const ex = bodyParam.example
    return { type: 'text', content: typeof ex === 'string' ? ex : JSON.stringify(ex, null, 2) }
  }
  const ref = extractModelRef(bodyParam.type)
  if (ref.ref !== undefined && models.has(ref.ref)) {
    const sample = sampleFromModel(ref.ref, models, new Set())
    const payload = ref.isArray ? [sample] : sample
    return { type: 'text', content: JSON.stringify(payload, null, 2) }
  }
  // A body declared with no resolvable model still deserves an empty JSON stub,
  // matching the import's `content = '{}'` fallback.
  return { type: 'text', content: '{}' }
}

/** Read the plain string a value holds (`StringValue`, `ExpressionValue`,
 * `NumericValue`, …), whether it arrives as a class instance or as the plain
 * object a deserialized project yields. Non-scalar values → undefined. */
function rawStringOfValue(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value
    if (typeof inner === 'string') return inner
    if (typeof inner === 'number' || typeof inner === 'boolean') return String(inner)
  }
  return undefined
}

const normalizeUrl = (u: string): string => u.trim().replace(/\/+$/, '')

/** Expand `{{other}}` references in a variable value against its sibling
 * variables in the same environment. The import stores `baseUrl` as a template
 * (`{{scheme}}://{{host}}:{{port}}{{baseRoute}}`), so a variable only reveals
 * the URL it points at once resolved. Depth-bounded so a self-referential
 * template can't loop; unknown refs are left verbatim. */
function resolveTemplate(raw: string, byKey: Map<string, string>, depth = 0): string {
  if (depth >= 6) return raw
  return raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole: string, name: string): string => {
    const sibling = byKey.get(name)
    return sibling === undefined ? whole : resolveTemplate(sibling, byKey, depth + 1)
  })
}

/** Every base-URL string the API's `server` block can spell, so a variable
 * resolving to any of them counts as "the API URL". Empty when there's no host. */
function baseUrlCandidates(server: ApiDocumentation['server']): { exact: Set<string>; hostPath: string } | undefined {
  const host = server?.host?.trim()
  if (host === undefined || host === '') return undefined
  const basePath = (server?.basePath ?? '').replace(/\/+$/, '')
  const hostPath = normalizeUrl(`${host}${basePath}`)
  const schemed = (server?.schemes ?? []).map((s) => `${s}://${hostPath}`)
  const exact = new Set([...schemed, `https://${hostPath}`, `http://${hostPath}`, `//${hostPath}`, hostPath].map(normalizeUrl))
  return { exact, hostPath }
}

/**
 * The `{{name}}` prefix to put in front of a doc-created request's path: the
 * ROOT-level environment variable that resolves to the API's base URL —
 * mirroring the `{{baseUrl}}` an import seeds. Matched by *resolved value*
 * (templates are expanded against sibling variables), since the variable is
 * not necessarily named `baseUrl`; non-recursive by design (root environments
 * only). Prefers an exact base-URL match over a looser host+path containment;
 * returns undefined when nothing matches, leaving the request path bare.
 */
export function resolveBaseUrlPrefix(
  rootEnvironments: Environment[],
  server: ApiDocumentation['server']
): string | undefined {
  const target = baseUrlCandidates(server)
  if (target === undefined) return undefined

  // Resolve each root variable once (per environment, against its siblings).
  const resolved: { key: string; value: string }[] = []
  for (const env of rootEnvironments) {
    const byKey = new Map<string, string>()
    for (const v of env.variables) {
      const raw = rawStringOfValue(v.value)
      if (raw !== undefined) byKey.set(v.key, raw)
    }
    for (const v of env.variables) {
      const raw = byKey.get(v.key)
      if (raw === undefined) continue
      const value = normalizeUrl(resolveTemplate(raw, byKey))
      if (value !== '') resolved.push({ key: v.key, value })
    }
  }

  const exact = resolved.find((r) => target.exact.has(r.value))
  if (exact !== undefined) return `{{${exact.key}}}`
  const loose = resolved.find((r) => r.value.includes(target.hostPath))
  return loose !== undefined ? `{{${loose.key}}}` : undefined
}

function generateId(seed: string): string {
  return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Convert an `OperationDocumentation` (the structured shape the
 * documentation viewer renders) into a freshly-built `HTTPRequest`.
 * Mirrors the import-time mapping (see
 * `OpenAPIImportService.operationToRequest`) so a request created
 * from a route block matches what an import would produce — same
 * url template (`{var}` → `{{var}}` for declared path params),
 * tags carried forward, optional parameters disabled by default.
 *
 * Pure: no React, no reactive proxy, no events. Callers are
 * responsible for mounting the request in the tree and emitting
 * `REQUEST_CREATED`.
 */
export function buildRequestFromOperation(
  operation: OperationDocumentation,
  models = new Map<string, ModelDocumentation>(),
  baseUrlPrefix?: string
): HTTPRequest {
  const declaredPathParamNames = new Set<string>()
  const headers: KeyValue[] = []
  const params: KeyValue[] = []
  const pathParams: KeyValue[] = []

  for (const p of operation.parameters ?? []) {
    if (p.location === 'header') headers.push(paramToKeyValue(p))
    else if (p.location === 'query') params.push(paramToKeyValue(p))
    else if (p.location === 'path') {
      pathParams.push(paramToKeyValue(p))
      declaredPathParamNames.add(p.name)
    }
    // `body` is handled below (→ request.body); `formData` and `cookie`
    // params have no first-class KV column yet and are intentionally skipped,
    // same as the import.
  }

  // Templated URL: `{petId}` → `{{petId}}` for declared path params,
  // leave undeclared `{x}` literal so the user can spot drift.
  const path = operation.match.urlPattern.replace(
    /\{([A-Za-z_$][A-Za-z0-9_$.\-]*)\}/g,
    (_match: string, name: string): string => declaredPathParamNames.has(name) ? `{{${name}}}` : `{${name}}`
  )
  // Prefix with the matched base-URL variable (`{{baseUrl}}/pet/…`), same as an
  // import — bare path when the env folder has no variable for the API URL.
  const url = baseUrlPrefix !== undefined && baseUrlPrefix !== '' ? `${baseUrlPrefix}${path}` : path

  const id = generateId('request')
  const name = operation.summary ?? operation.operationId ?? `${operation.match.method ?? 'HTTP'} ${operation.match.urlPattern}`

  const request: HTTPRequest = {
    type: 'http',
    id,
    name,
    tags: operation.group !== undefined ? [operation.group] : [],
    method: toHTTPMethod(operation.match.method),
    url,
    headers,
    params,
    pathParams
  }
  if (operation.deprecated === true) request.deprecated = true
  const body = bodyFromOperation(operation, models)
  if (body) request.body = body
  return request
}
