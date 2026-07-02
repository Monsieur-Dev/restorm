/**
 * tRPC Execution Service
 *
 * A thin request-shaping layer over `HTTPExecutionService` (per the
 * "protocol layers on plain HTTP" precedent OData/auth already follow): it
 * composes the v10 non-batch wire format via `composeTrpcRequestBody`
 * (the URL — `<base>/<procedure>` plus `?input=` for a query — is already
 * composed by `URLResolver`), dispatches through `httpExecutionService`, and
 * unwraps the `[{ result: { data } }]` envelope so the response panel shows
 * just the data, with the raw envelope kept for the "Show raw envelope"
 * toggle.
 *
 * No separate active-requests / abort-controller bookkeeping: cancellation
 * delegates straight to `httpExecutionService.cancel(requestId)` — the
 * underlying HTTP call IS the tRPC call.
 */

import { contextService } from './ContextService'
import { httpExecutionService, type HTTPExecutionInput } from './HTTPExecutionService'
import { composeTrpcRequestBody, unwrapTrpcEnvelope, unwrapTrpcError } from '../../shared/utils/trpcRequestBody'
import type { AuthenticationRequest } from '../../shared/models/requests/AuthenticationRequest'

export interface TrpcExecutionInput {
  requestId: string
  timeout?: number
  authRequest?: AuthenticationRequest
}

/** tRPC response result. `data` is the unwrapped `result.data` payload;
 * `rawBody` is the full wire envelope (kept for the raw-envelope toggle and
 * for a call that didn't parse as the expected shape — a procedure error, a
 * non-JSON body, or a transport failure). */
export interface TrpcExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  headers?: Record<string, string | string[]>
  data?: unknown
  rawBody?: string
  bodyIsBase64?: boolean
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  requestHeaders?: Record<string, string>
}

class TrpcExecutionService {
  async execute(input: TrpcExecutionInput): Promise<TrpcExecutionResult> {
    const { requestId, timeout, authRequest } = input
    const requestContext = contextService.getRequestContext(requestId)
    const kind = requestContext?.fullData.trpcKind
    const composed = composeTrpcRequestBody({ kind, input: requestContext?.fullData.trpcInput })

    const httpInput: HTTPExecutionInput = {
      requestId,
      method: composed.method,
      ...(timeout !== undefined ? { timeout } : {}),
      ...(composed.rawBody !== undefined
        ? { rawBody: composed.rawBody, ...(composed.rawBodyContentType !== undefined ? { rawBodyContentType: composed.rawBodyContentType } : {}) }
        : {}),
      ...(authRequest ? { authRequest } : {})
    }

    const result = await httpExecutionService.execute(httpInput)
    // `result.error` only ever carries a TRANSPORT failure (HTTPExecutionService
    // treats a completed 4xx/5xx response as `success: true`); a tRPC-LEVEL
    // error (a procedure throwing `NOT_FOUND`, say) lives in the wire envelope
    // itself and must be parsed out separately so it reaches the response
    // panel's default (non-raw-envelope) view.
    return {
      requestId,
      success: result.success,
      statusCode: result.statusCode,
      statusText: result.statusText,
      headers: result.headers,
      data: unwrapTrpcEnvelope(result.body),
      rawBody: result.body,
      bodyIsBase64: result.bodyIsBase64,
      error: result.error ?? unwrapTrpcError(result.body),
      timings: result.timings,
      requestUrl: result.requestUrl,
      requestHeaders: result.requestHeaders
    }
  }

  cancel(requestId: string): boolean {
    return httpExecutionService.cancel(requestId)
  }

  isActive(requestId: string): boolean {
    return httpExecutionService.isActive(requestId)
  }
}

export const trpcExecutionService = new TrpcExecutionService()
