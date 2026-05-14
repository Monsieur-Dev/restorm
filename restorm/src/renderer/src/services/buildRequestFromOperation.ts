import type { OperationDocumentation, ParameterDocumentation } from '../../../shared/types/apiDocumentation'
import type { HTTPRequest, HTTPMethod, KeyValue } from '../../../shared/types/collections'
import { StringValue } from '../../../shared/types/collections'

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

function paramToKeyValue(p: ParameterDocumentation): KeyValue {
  const initialValue = p.defaultValue ?? exampleToString(p.example)
  return {
    key: p.name,
    value: new StringValue(initialValue),
    enabled: p.required,
    description: p.description ?? ''
  }
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
export function buildRequestFromOperation(operation: OperationDocumentation): HTTPRequest {
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
  }

  // Templated URL: `{petId}` → `{{petId}}` for declared path params,
  // leave undeclared `{x}` literal so the user can spot drift.
  const url = operation.match.urlPattern.replace(
    /\{([A-Za-z_$][A-Za-z0-9_$.\-]*)\}/g,
    (_match: string, name: string): string => declaredPathParamNames.has(name) ? `{{${name}}}` : `{${name}}`
  )

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
  return request
}
