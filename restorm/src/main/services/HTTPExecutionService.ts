/**
 * HTTP Execution Service
 * Handles HTTP request execution in the main process with cancel support
 */

import http from 'http'
import https from 'https'
import { URL } from 'url'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { authenticationCacheService, type ResolvedAuthShape } from './AuthenticationCacheService'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../shared/config/constants'
import type { AuthenticationRequest } from '../../shared/models/requests/AuthenticationRequest'

/** HTTP request execution input */
export interface HTTPExecutionInput {
  requestId: string
  method: string
  timeout?: number
  /** Optional raw request body override. When provided, bypasses the
   * ContextService-built body entirely — used by the OData engine to
   * dispatch action invocations with a caller-supplied JSON payload. */
  rawBody?: string
  /** Optional Content-Type to set alongside `rawBody`. */
  rawBodyContentType?: string
  /** Optional URL override. When provided, the URL is used as-is and
   * the ContextService's resolved URL + query-option composition is
   * skipped entirely. Headers + body still come from the registered
   * request context. Used for "follow link" operations like
   * `@odata.nextLink` pagination where the server already composed
   * the full URL. */
  urlOverride?: string
  /** Optional authentication request whose produced headers are
   * fetched (via the main-process cache) and merged into this
   * request's headers before dispatch. When the downstream call
   * completes with a status listed in `authRequest.authErrorCodes`,
   * the cache is invalidated and the call is retried once. */
  authRequest?: AuthenticationRequest
}

/** HTTP response result */
export interface HTTPExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  headers?: Record<string, string | string[]>
  body?: string
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  /** Headers actually sent with the request, after auth injection.
   * Surfaced so the renderer's response panel can show the auth
   * headers that were merged in at dispatch time. */
  requestHeaders?: Record<string, string>
}

/** Active request info */
interface ActiveRequest {
  requestId: string
  abortController: AbortController
  startTime: number
}

/**
 * Service for executing HTTP requests in the main process
 */
class HTTPExecutionService {
  private activeRequests = new Map<string, ActiveRequest>()

  /**
   * Execute an HTTP request using the resolved URL and data from ContextService
   */
  async execute(input: HTTPExecutionInput): Promise<HTTPExecutionResult> {
    const { requestId, method, timeout = DEFAULT_REQUEST_TIMEOUT_MS, rawBody, rawBodyContentType, urlOverride, authRequest } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    let resolvedUrl: string
    if (urlOverride !== undefined && urlOverride !== '') {
      // Skip the ContextService URL composition: the caller already
      // has a fully-formed URL (server-returned nextLink, navigation
      // link, etc.) and we must dispatch it verbatim.
      resolvedUrl = urlOverride
    } else {
      const urlResult = contextService.getResolvedUrl(requestId)
      if (!urlResult) {
        return {
          requestId,
          success: false,
          error: 'No resolved URL found for this request. Make sure the request is registered.',
          timings: { startedAt, durationMs: Date.now() - startTime }
        }
      }
      resolvedUrl = urlResult.resolvedUrl
    }
    logger.info('[HTTPExecutionService] Executing request', { requestId, method, url: resolvedUrl })

    // Get request context for headers and body
    const requestContext = contextService.getRequestContext(requestId)
    
    // Create abort controller for cancellation
    const abortController = new AbortController()
    this.activeRequests.set(requestId, { requestId, abortController, startTime })

    // Broadcast that request started
    this.broadcastProgress(requestId, 'started')

    try {
      // Parse URL
      let parsedUrl: URL
      try {
        parsedUrl = new URL(resolvedUrl)
      } catch {
        return {
          requestId,
          success: false,
          error: `Invalid URL: ${resolvedUrl}`,
          timings: { startedAt, durationMs: Date.now() - startTime }
        }
      }

      // Build headers from context (skip disabled ones)
      const headers: Record<string, string> = {}
      if (requestContext?.keyValueGroups) {
        const headersGroup = requestContext.keyValueGroups.get('headers')
        if (headersGroup) {
          for (const h of headersGroup) {
            // Skip disabled headers (enabled defaults to true if undefined)
            if (h.enabled === false) {
              continue
            }
            if (h.key) {
              // Type-aware resolution: only `ExpressionValue` rows
              // get handlebars-substituted; a `StringValue` row
              // ships verbatim. The old `resolveValue(h.value, …)`
              // path always ran the resolver regardless of type,
              // so a user who handcrafted `{{token}}` as a plain
              // string saw it silently expanded on send.
              headers[h.key] = contextService.resolveKeyValueForRequest(h, requestId)
            }
          }
        }
      }

      // Build body — a caller-supplied `rawBody` (e.g. an OData action
      // POST payload) takes precedence over anything the
      // ContextService would compose from the request's structured
      // body fields.
      let body: string | undefined
      if (rawBody !== undefined) {
        body = contextService.resolveValue(rawBody, requestId)
        if (rawBodyContentType) {
          headers['Content-Type'] ??= rawBodyContentType
        }
      } else if (requestContext?.fullData?.body) {
        const bodyData = requestContext.fullData.body
        switch (bodyData.type) {
          case 'text':
            body = contextService.resolveValue(bodyData.content, requestId)
            break
          case 'x-www-form-urlencoded': {
            const params = new URLSearchParams()
            for (const field of bodyData.fields) {
              if (field.key) {
                // `field.value` arrives either as a raw string (renderer
                // IPC path) or a `ValueType` instance (main-side flush
                // path). Coerce uniformly — body templates always run
                // through handlebars regardless of declared type.
                const rawValue = typeof field.value === 'string' ? field.value : field.value.toString()
                const resolvedKey = contextService.resolveValue(field.key, requestId)
                const resolvedValue = contextService.resolveValue(rawValue, requestId)
                params.append(resolvedKey, resolvedValue)
              }
            }
            body = params.toString()
            headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
            break
          }
          case 'form-data':
          case 'file':
            // `form-data` and `file` reach the wire through a dedicated
            // upload path elsewhere; leaving `body` undefined here is
            // intentional. The warning is a tripwire in case that path
            // ever stops claiming these requests and they accidentally
            // fall through to the plain executor.
            logger.warn('[HTTPExecutionService] body type requires a dedicated handler and is not yet routed through this executor', {
              requestId,
              bodyType: bodyData.type
            })
            break
          default: {
            // Compile-time exhaustiveness: forces the developer to
            // re-visit this switch whenever a new variant is added to
            // `HTTPRequestBody`. The runtime branch defends against
            // bad persisted state / MCP callers that bypass schema
            // checks — used to drop silently and surface as a generic
            // upstream 4xx.
            const _exhaustive: never = bodyData
            const unknownType = (bodyData as { type?: unknown }).type
            return {
              requestId,
              success: false,
              error: `Unknown body type: ${JSON.stringify(unknownType)}. Valid values: text, file, form-data, x-www-form-urlencoded.`,
              timings: { startedAt, durationMs: Date.now() - startTime }
            }
          }
        }
      }

      // Inject auth headers (fresh or cached) before dispatching.
      // The resolved shape doubles as (a) the cache key (so an env-A
      // → env-B → env-A round-trip reuses A's entry on the third
      // call), and (b) the on-the-wire payload the executor closure
      // hands to `dispatchAuthShape` — same bytes both sides.
      let authShape: ResolvedAuthShape | null = null
      if (authRequest) {
        const resolved = this.resolveAuthShape(authRequest, requestId)
        if (!resolved.ok) {
          const durationMs = Date.now() - startTime
          this.broadcastProgress(requestId, 'error')
          return {
            requestId,
            success: false,
            error: resolved.error,
            requestUrl: resolvedUrl,
            timings: { startedAt, durationMs }
          }
        }
        authShape = resolved.shape
        try {
          const authHeaders = await authenticationCacheService.getHeaders(
            authRequest,
            authShape,
            (s) => this.dispatchAuthShape(authRequest, s, abortController.signal)
          )
          for (const [k, v] of Object.entries(authHeaders)) {
            headers[k] = v
          }
        } catch (authErr) {
          const durationMs = Date.now() - startTime
          this.broadcastProgress(requestId, 'error')
          return {
            requestId,
            success: false,
            error: authErr instanceof Error ? authErr.message : String(authErr),
            requestUrl: resolvedUrl,
            timings: { startedAt, durationMs }
          }
        }
      }

      // Execute request
      let result = await this.makeRequest({
        url: parsedUrl,
        method: method.toUpperCase(),
        headers,
        body,
        timeout,
        signal: abortController.signal
      })

      // Auth-error-code retry: if the downstream status is one the
      // auth request declared as "your token expired", invalidate
      // the cache, force a refresh, re-inject, retry exactly once.
      if (authRequest && authShape && authRequest.authErrorCodes.includes(result.statusCode)) {
        authenticationCacheService.invalidate(authRequest, authShape)
        try {
          const refreshed = await authenticationCacheService.refresh(
            authRequest,
            authShape,
            (s) => this.dispatchAuthShape(authRequest, s, abortController.signal)
          )
          for (const [k, v] of Object.entries(refreshed)) {
            headers[k] = v
          }
          result = await this.makeRequest({
            url: parsedUrl,
            method: method.toUpperCase(),
            headers,
            body,
            timeout,
            signal: abortController.signal
          })
        } catch (authErr) {
          logger.warn('[HTTPExecutionService] auth refresh during retry failed', {
            error: String(authErr)
          })
        }
      }

      const durationMs = Date.now() - startTime

      // Broadcast completion
      this.broadcastProgress(requestId, 'completed')

      return {
        requestId,
        success: true,
        statusCode: result.statusCode,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body,
        requestUrl: resolvedUrl,
        // Clone `headers` so downstream mutations on the request
        // path don't retroactively edit the result we're returning.
        requestHeaders: { ...headers },
        timings: { startedAt, durationMs }
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const error = err as Error
      
      // Check if cancelled
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        this.broadcastProgress(requestId, 'cancelled')
        return {
          requestId,
          success: false,
          error: 'Request cancelled',
          requestUrl: resolvedUrl,
          timings: { startedAt, durationMs }
        }
      }

      this.broadcastProgress(requestId, 'error')
      
      return {
        requestId,
        success: false,
        error: error.message || 'Request failed',
        requestUrl: resolvedUrl,
        timings: { startedAt, durationMs }
      }
    } finally {
      this.activeRequests.delete(requestId)
    }
  }

  /**
   * Cancel an active request
   */
  cancel(requestId: string): boolean {
    const activeRequest = this.activeRequests.get(requestId)
    if (activeRequest) {
      logger.info('[HTTPExecutionService] Cancelling request', { requestId })
      activeRequest.abortController.abort()
      return true
    }
    return false
  }

  /**
   * Check if a request is currently active
   */
  isActive(requestId: string): boolean {
    return this.activeRequests.has(requestId)
  }

  /**
   * Make the actual HTTP request
   */
  private makeRequest(options: {
    url: URL
    method: string
    headers: Record<string, string>
    body?: string
    timeout: number
    signal: AbortSignal
  }): Promise<{ statusCode: number; statusText: string; headers: Record<string, string | string[]>; body: string }> {
    return new Promise((resolve, reject) => {
      const { url, method, headers, body, timeout, signal } = options
      
      const isHttps = url.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const requestOptions: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout
      }

      // Handle abort signal
      const abortHandler = (): void => {
        request.destroy()
        reject(new Error('AbortError'))
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      const request = httpModule.request(requestOptions, (response) => {
        const chunks: Buffer[] = []

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        response.on('end', () => {
          signal.removeEventListener('abort', abortHandler)
          const bodyBuffer = Buffer.concat(chunks)
          const bodyString = bodyBuffer.toString('utf-8')

          // Convert headers to plain object
          const responseHeaders: Record<string, string | string[]> = {}
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              responseHeaders[key] = value
            }
          }

          resolve({
            statusCode: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: responseHeaders,
            body: bodyString
          })
        })

        response.on('error', (err) => {
          signal.removeEventListener('abort', abortHandler)
          reject(err)
        })
      })

      request.on('error', (err) => {
        signal.removeEventListener('abort', abortHandler)
        reject(err)
      })

      request.on('timeout', () => {
        signal.removeEventListener('abort', abortHandler)
        request.destroy()
        reject(new Error('Request timeout'))
      })

      if (body) {
        request.write(body)
      }

      request.end()
    })
  }

  /**
   * Broadcast progress to renderer
   */
  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('http:request-progress', { requestId, status })
    }
  }

  /**
   * Execute an auth request so the cache layer can populate itself.
   * Uses ContextService when the request is registered (normal
   * production path), falls back to the auth request's own URL /
   * method / headers / body otherwise (import-wizard path, where
   * the auth request is ephemeral and not yet in the collection).
   */
  /**
   * Resolve the env-dependent surface of an auth request — URL,
   * headers, body — into a `ResolvedAuthShape` ready to (a) feed the
   * authentication cache as the lookup key and (b) drive the actual
   * HTTP dispatch. Returns an error variant when resolution can't
   * produce a valid wire request (no URL, malformed URL); the
   * caller surfaces those via a failed HTTPExecutionResult, the
   * cache never sees them.
   *
   * `parentRequestId` carries the original calling request so we
   * can inherit its env when the auth route's own pinned env is a
   * sibling of the parent's env (the per-tab pinning regression
   * the e2e pins).
   */
  private resolveAuthShape(
    authRequest: AuthenticationRequest,
    parentRequestId?: string
  ): { ok: true; shape: ResolvedAuthShape; resolvedUrl: string; parsedUrl: URL } | { ok: false; error: string } {
    // Choose which env-context resolves auth handlebars / URL / body.
    //
    // Default: the auth route's own context (its tab's selected env).
    // Override: when the *parent* request's selected env is ALSO in
    // the auth route's `availableEnvironmentIds` — i.e. visible to
    // the auth route through its env-folder hierarchy — we use the
    // parent's env instead. This lets a request with env "Valid"
    // drive an auth route pinned to "Invalid" (sibling env in the
    // same tree) and have the auth pick up "Valid" because it's
    // available to both. Without this, the auth route's pinned env
    // would always win and you'd authenticate against the wrong
    // credentials whenever the calling request used a different env.
    //
    // The fall-through to `parentRequestId` (when the auth request
    // was never registered — import-wizard path) stays as before:
    // `inheritParentEnv` becomes the only path that resolves the
    // auth values in that case.
    const authCtxForEnv = contextService.getRequestContext(authRequest.id)
    const parentCtxForEnv = parentRequestId
      ? contextService.getRequestContext(parentRequestId)
      : undefined
    const parentEnvIdForAuth = parentCtxForEnv?.environmentId ?? null
    const inheritParentEnv =
      parentEnvIdForAuth !== null &&
      !!authCtxForEnv &&
      authCtxForEnv.availableEnvironmentIds.includes(parentEnvIdForAuth)
    const resolutionRequestId = inheritParentEnv && parentRequestId
      ? parentRequestId
      : authRequest.id

    // Prefer the ContextService-resolved URL when it matches the env
    // we're going to resolve against — i.e. only when the auth route
    // owns the resolution. When inheriting the parent's env we have
    // to re-resolve the raw `authRequest.url` against the parent's
    // context; the cached resolved URL was minted with a different
    // env and would point at the wrong host / path / params.
    const authUrlResult = inheritParentEnv
      ? undefined
      : contextService.getResolvedUrl(authRequest.id)
    let resolvedUrl: string
    if (authUrlResult) {
      resolvedUrl = authUrlResult.resolvedUrl
    } else if (contextService.getRequestContext(resolutionRequestId)) {
      resolvedUrl = contextService.resolveValue(authRequest.url, resolutionRequestId)
    } else if (parentRequestId && contextService.getRequestContext(parentRequestId)) {
      resolvedUrl = contextService.resolveValue(authRequest.url, parentRequestId)
    } else {
      resolvedUrl = authRequest.url
    }
    if (!resolvedUrl) {
      return { ok: false, error: 'Auth request has no URL' }
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(resolvedUrl)
    } catch {
      return { ok: false, error: `Invalid auth URL: ${resolvedUrl}` }
    }

    // Build headers — ContextService for the registered path,
    // raw auth-request headers otherwise.
    const headers: Record<string, string> = {}
    const authCtx = authCtxForEnv
    // Resolve against `resolutionRequestId` (auth's own env normally,
    // parent's env when inheritance is on). Fall back to parent's
    // context when neither auth nor the resolution request is
    // registered (import-wizard path).
    const resolveForAuth = (value: string): string => {
      if (contextService.getRequestContext(resolutionRequestId)) {
        return contextService.resolveValue(value, resolutionRequestId)
      }
      if (parentRequestId && contextService.getRequestContext(parentRequestId)) {
        return contextService.resolveValue(value, parentRequestId)
      }
      return value
    }
    const headerSource = authCtx?.keyValueGroups.get('headers') ?? authRequest.headers
    // After IPC marshal the fallback path sees `{ type, value }`
    // objects instead of `StringValue` / `PasswordValue` instances;
    // `.toString()` on those returns `[object Object]`.
    const extractString = (v: unknown): string => {
      if (typeof v === 'string') return v
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      if (v && typeof v === 'object') {
        const obj = v as { toString?: () => string; value?: unknown }
        if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
          // Class instances (`StringValue`, `PasswordValue`, …) still
          // round-trip through here in the ContextService path.
          return obj.toString()
        }
        if (typeof obj.value === 'string') return obj.value
        if (typeof obj.value === 'number' || typeof obj.value === 'boolean') return String(obj.value)
      }
      return ''
    }
    for (const h of headerSource) {
      if (h.enabled === false) continue
      if (!h.key) continue
      // When the auth request IS registered with ContextService, use
      // the type-aware path (gates substitution on `ExpressionValue`
      // vs `StringValue`, same invariant as the main request headers).
      // Otherwise fall back to the unconditional resolve — the auth
      // never reached `register-request`, so we don't have a `KeyValue`
      // with a real `ValueType` to gate on anyway (the renderer-import
      // path lands here for spec-fetch auth).
      if (contextService.getRequestContext(resolutionRequestId)) {
        headers[h.key] = contextService.resolveKeyValueForRequest(h, resolutionRequestId)
      } else if (parentRequestId && contextService.getRequestContext(parentRequestId)) {
        headers[h.key] = contextService.resolveKeyValueForRequest(h, parentRequestId)
      } else {
        headers[h.key] = extractString(h.value)
      }
    }

    // Build body.
    let body: string | undefined
    if (authCtx?.fullData?.body) {
      const bodyData = authCtx.fullData.body
      if (bodyData.type === 'text') {
        body = contextService.resolveValue(bodyData.content, resolutionRequestId)
      } else if (bodyData.type === 'x-www-form-urlencoded') {
        const params = new URLSearchParams()
        for (const field of bodyData.fields) {
          if (!field.key) continue
          // `field.value` typed as `ValueType` — `flushRequestStateToContext`
          // pushes the live class instance through, while the legacy
          // renderer→IPC path lands a `string`. Coerce uniformly so
          // `resolveValue` (which expects a string template) sees the
          // raw template either way.
          const rawValue = typeof field.value === 'string' ? field.value : field.value.toString()
          const k = contextService.resolveValue(field.key, resolutionRequestId)
          const v = contextService.resolveValue(rawValue, resolutionRequestId)
          params.append(k, v)
        }
        body = params.toString()
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
      }
    } else if (authRequest.body) {
      // Fallback path — ContextService hasn't seen this auth request
      // (the auth-tab was never mounted in this session). Serialize
      // directly off the `AuthenticationRequest`. Handlebars still get
      // resolved via `resolveForAuth`, which falls back to the parent
      // request's environment when the auth itself isn't registered.
      // `x-www-form-urlencoded` is the only shape OAuth token
      // endpoints care about, and it's also the one the request's own
      // Send flow uses, so a request that works in its own tab must
      // work from the cache layer too.
      const authBody = authRequest.body
      if (authBody.type === 'text' && typeof authBody.content === 'string') {
        body = resolveForAuth(authBody.content)
      } else if (authBody.type === 'x-www-form-urlencoded') {
        const params = new URLSearchParams()
        // IPC marshal turns every `StringValue` / `PasswordValue` /
        // etc. into the persisted `{ type, value }` shape — the
        // class-instance `.toString()` path is gone by the time we
        // run here. Extract the string payload manually.
        for (const field of authBody.fields) {
          if (!field.key) continue
          params.append(field.key, resolveForAuth(extractString(field.value)))
        }
        body = params.toString()
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
      }
    }

    return {
      ok: true,
      shape: {
        method: authRequest.method,
        url: resolvedUrl,
        headers,
        ...(body !== undefined ? { body } : {})
      },
      resolvedUrl,
      parsedUrl
    }
  }

  /**
   * Fire the resolved auth shape on the wire and surface the raw
   * HTTP outcome. The cache hands us the same `shape` it derived
   * its key from, so the bytes that end up on the network match
   * the bytes the cache will associate with the resulting headers.
   */
  private async dispatchAuthShape(
    authRequest: AuthenticationRequest,
    shape: ResolvedAuthShape,
    parentSignal: AbortSignal
  ): Promise<HTTPExecutionResult> {
    const startTime = Date.now()
    const startedAt = new Date().toISOString()
    let parsedUrl: URL
    try {
      parsedUrl = new URL(shape.url)
    } catch {
      return {
        requestId: authRequest.id,
        success: false,
        error: `Invalid auth URL: ${shape.url}`,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }
    const result = await this.makeRequest({
      url: parsedUrl,
      method: shape.method,
      headers: shape.headers,
      ...(shape.body !== undefined ? { body: shape.body } : {}),
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      signal: parentSignal
    })
    const durationMs = Date.now() - startTime
    return {
      requestId: authRequest.id,
      success: true,
      statusCode: result.statusCode,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      requestUrl: shape.url,
      timings: { startedAt, durationMs }
    }
  }
}

/** Singleton instance */
export const httpExecutionService = new HTTPExecutionService()
