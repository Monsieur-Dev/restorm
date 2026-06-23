/**
 * Compose the HTTP method + request body for an OData operation.
 *
 * Single source of truth shared by BOTH dispatch paths so they produce
 * byte-identical wire bodies:
 *   - the request-panel Send (renderer `handleSend` → `odata:execute` IPC), and
 *   - the scenario engine (`httpRequestExecutor` OData branch).
 *
 * Derivation by `operationKind`:
 *   - entity-set / function: a GET read, no body.
 *   - action: a POST carrying the `actionBody` JSON payload.
 *   - batch: a POST whose body is the assembled `$batch` envelope —
 *     multipart/mixed (default) or JSON batch (`batchFormat === 'json'`),
 *     built from the structured `batchSubRequests` via the SAME serializers
 *     the request panel uses (`serializeODataBatch` / `serializeODataJsonBatch`).
 */

import {
  serializeODataBatch,
  serializeODataJsonBatch,
  type ODataBatchSubRequest
} from './odataBatch'

/** The subset of an OData request the body composer reads. Kept structural
 * (not the full model) so both a reactive request proxy and a plain object
 * satisfy it. */
export interface ODataBodySource {
  operationKind?: string
  url: string
  odataVersion?: string
  actionBody?: string
  batchFormat?: string
  forceAbsoluteBatchUrls?: boolean
  allowGetInChangeSet?: boolean
  batchSubRequests?: {
    method: string
    url: string
    headers?: { key: string; value: string }[]
    body?: string
    atomicityGroup?: string
    forceIncludeInChangeSet?: boolean
  }[]
}

export interface ODataComposedBody {
  /** Verb to dispatch: GET for entity-set / function reads, POST for
   * action / batch. */
  method: string
  /** Raw request body — set only for action (the JSON payload) and batch
   * (the `$batch` envelope); undefined for reads. */
  rawBody?: string
  /** Content-Type to set alongside `rawBody` (the batch boundary header for
   * a multipart envelope, the JSON-batch content type, or undefined for an
   * action where the default `application/json` applies). */
  rawBodyContentType?: string
  /** Non-blocking serializer warnings (e.g. GET inside a change-set). */
  batchWarnings?: string[]
  /** When the batch has no sub-requests, a user-facing error message instead
   * of a body — the caller decides how to surface it (the request panel shows
   * a response-panel error; the scenario executor throws). */
  error?: string
}

/**
 * Compose `{ method, rawBody?, rawBodyContentType? }` for an OData request.
 * The URL itself is composed elsewhere (the ContextService / URLResolver from
 * the request's query options); this only owns the verb + body.
 */
export function composeODataRequestBody(request: ODataBodySource): ODataComposedBody {
  if (request.operationKind === 'action') {
    return {
      method: 'POST',
      ...(request.actionBody !== undefined && request.actionBody.length > 0
        ? { rawBody: request.actionBody }
        : {})
    }
  }

  if (request.operationKind === 'batch') {
    const specs = request.batchSubRequests ?? []
    if (specs.length === 0) {
      return { method: 'POST', error: 'Batch has no sub-requests — add at least one before sending.' }
    }
    const subRequests: ODataBatchSubRequest[] = specs.map((spec) => {
      const headers: Record<string, string> = {}
      for (const kv of spec.headers ?? []) {
        if (kv.key) headers[kv.key] = kv.value
      }
      return {
        method: spec.method,
        url: spec.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(spec.body !== undefined ? { body: spec.body } : {}),
        ...(spec.atomicityGroup ? { atomicityGroup: spec.atomicityGroup } : {}),
        ...(spec.forceIncludeInChangeSet ? { forceIncludeInChangeSet: true } : {})
      }
    })
    // v4.01 emits relative batch URIs unless the user opted out. Service root
    // for relative-URL conversion: strip the `/$batch` suffix (+ query string);
    // if absent, drop the last path segment as a best-effort guess.
    const isV401 = request.odataVersion === 'v4.01'
    const batchServiceRoot = isV401 && !request.forceAbsoluteBatchUrls
      ? (request.url.includes('/$batch')
        ? request.url.replace(/\/\$batch.*$/, '')
        : request.url.replace(/\/[^/]*$/, ''))
      : undefined
    if (request.batchFormat === 'json') {
      const serialized = serializeODataJsonBatch(subRequests, {
        ...(batchServiceRoot !== undefined ? { serviceRoot: batchServiceRoot } : {}),
        ...(request.forceAbsoluteBatchUrls ? { forceAbsoluteUrls: true } : {})
      })
      return { method: 'POST', rawBody: serialized.body, rawBodyContentType: serialized.contentType }
    }
    const serialized = serializeODataBatch(subRequests, undefined, {
      allowGetInChangeSet: request.allowGetInChangeSet ?? false,
      ...(batchServiceRoot !== undefined ? { serviceRoot: batchServiceRoot } : {}),
      ...(request.forceAbsoluteBatchUrls ? { forceAbsoluteUrls: true } : {})
    })
    return {
      method: 'POST',
      rawBody: serialized.body,
      rawBodyContentType: serialized.contentType,
      ...(serialized.warnings.length > 0 ? { batchWarnings: serialized.warnings } : {})
    }
  }

  // entity-set / function read.
  return { method: 'GET' }
}
