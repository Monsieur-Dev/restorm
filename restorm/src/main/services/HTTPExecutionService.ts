/**
 * HTTP Execution Service
 * Handles HTTP request execution in the main process with cancel support
 */

import http from 'http'
import https from 'https'
import type { IncomingMessage, ServerResponse } from 'http'
import fs from 'fs'
import { basename } from 'path'
import { randomBytes } from 'crypto'
import { URL } from 'url'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { websocketExecutionService } from './WebSocketExecutionService'
import { authenticationCacheService, type ResolvedAuthShape } from './AuthenticationCacheService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { withFirewallBypass } from 'electron-core-ui/main'
import { DEFAULT_REQUEST_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../../shared/config/constants'
import type { AuthenticationRequest } from '../../shared/models/requests/AuthenticationRequest'

/** One served HTTP-mock request, surfaced on a scenario `httpListen` node's
 * `served` output (shape mirrors the `{ request, response }` an httpRequest
 * node emits, so a JSON-path picker drills it the same way). */
interface ServedSummary {
  request: { method: string; url: string; headers: Record<string, string> }
  response: { status: number; headers: Record<string, string>; body: string }
}

/** Flatten Node's `IncomingHttpHeaders` (string | string[] | undefined) to a
 * plain string map for the served summary. */
function flattenIncomingHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

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
  /** Follow 3xx redirects (301/302/303/307/308). Defaults to `true`
   * when undefined — most users expect a Send to land on the final
   * resource. Set `false` to surface the raw redirect response. */
  followRedirects?: boolean
}

/** HTTP response result */
export interface HTTPExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  headers?: Record<string, string | string[]>
  body?: string
  /** When the response body was detected as binary (by Content-Type or
   * non-text bytes) the `body` carries a base64 encoding instead of a
   * UTF-8 string, and this flag is `true`. The renderer offers a
   * download rather than corrupting the bytes through a text render. */
  bodyIsBase64?: boolean
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
  /** Per-request served-request counter for hosted HTTP mock routes (server
   * mode). Drives the "served N requests" banner. */
  private servedCounts = new Map<string, number>()

  /**
   * Session cookie jar: origin (`scheme://host:port`) → cookie
   * name → value. Populated from `Set-Cookie` response headers and
   * re-attached as a `Cookie` request header on subsequent requests to
   * the same origin within this app session. Process-lifetime scoped
   * (cleared when a new collection is opened, alongside the auth cache),
   * which matches the ticket's "stored and re-sent across requests in
   * the same session" requirement without persisting credentials to
   * disk.
   */
  private cookieJar = new Map<string, Map<string, string>>()

  /**
   * Execute an HTTP request using the resolved URL and data from ContextService
   */
  async execute(input: HTTPExecutionInput): Promise<HTTPExecutionResult> {
    const { requestId, method, timeout = DEFAULT_REQUEST_TIMEOUT_MS, rawBody, rawBodyContentType, urlOverride, authRequest, followRedirects = true } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    // Create abort controller for cancellation
    const abortController = new AbortController()
    this.activeRequests.set(requestId, { requestId, abortController, startTime })

    // Broadcast that request started
    this.broadcastProgress(requestId, 'started')

    // Declared before the try so the catch's error responses can report
    // the URL even if resolution itself threw.
    let resolvedUrl = ''

    try {
      // Resolve any SecretValues reachable from this request's KeyValue
      // groups (headers / params / path) AND from the active env-folder
      // variable chain BEFORE the URL / context is read below. The sync
      // resolution path (`resolveKeyValueForRequest`) returns
      // `value.toString()`, which is empty for an un-hydrated secret;
      // hydration populates each `SecretValue.resolved` in place so the
      // verbatim row ships its plaintext. Scope the cache by requestId —
      // the single funnel shared by the classic Send button and the
      // scenario httpRequest node. A resolver failure aborts the dispatch
      // rather than sending a request with an empty secret.
      const requestContextForSecrets = contextService.getRequestContext(requestId)
      const envSecrets = contextService.collectEnvironmentSecrets(requestId)
      const secrets = [...collectRequestSecrets(requestContextForSecrets?.keyValueGroups), ...envSecrets]
      if (secrets.length > 0) {
        await secretHydrationService.hydrate(requestId, secrets, abortController.signal)
        // Env-folder secrets feed the transformed context (and the
        // pre-computed resolved URL), not the request's KeyValue rows in
        // place — re-resolve the context so the freshly-hydrated plaintext
        // reaches the request's baseContext + resolved URL read below.
        if (envSecrets.length > 0) {
          contextService.refreshEnvironmentContext(requestId)
        }
      }

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
      // body fields. `form-data` / `file` produce a `Buffer` (a
      // multipart payload with a generated boundary); everything else
      // is a `string`.
      let body: string | Buffer | undefined
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
          case 'form-data': {
            // Build a real multipart/form-data payload: each enabled
            // field becomes a text part; a field whose value resolves
            // to an existing file path is streamed as a file part (so
            // `multipart/form-data` with a file upload works end-to-end
            // against e.g. Petstore `/pet/{id}/uploadImage`).
            const built = this.buildMultipartBody(bodyData.fields, requestId)
            body = built.buffer
            headers['Content-Type'] ??= `multipart/form-data; boundary=${built.boundary}`
            break
          }
          case 'file': {
            // Stream the file's bytes as the raw request body. The
            // Content-Type is left to the user's headers (or omitted)
            // — a single-file PUT/POST sends the file verbatim, not a
            // multipart envelope.
            const resolvedPath = contextService.resolveValue(bodyData.path, requestId)
            if (resolvedPath && fs.existsSync(resolvedPath)) {
              body = fs.readFileSync(resolvedPath)
            } else if (resolvedPath) {
              return {
                requestId,
                success: false,
                error: `File not found: ${resolvedPath}`,
                requestUrl: resolvedUrl,
                timings: { startedAt, durationMs: Date.now() - startTime }
              }
            }
            break
          }
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
        signal: abortController.signal,
        followRedirects
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
            signal: abortController.signal,
            followRedirects
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
        // A response WAS received, so the round-trip SUCCEEDED — the
        // catch below owns transport/throw failures. `success` here means
        // "we got a response"; the HTTP status (incl. 4xx/5xx) is carried
        // on `statusCode` for the renderer's response pane + the auth /
        // status-routing layers to interpret. Folding the status into
        // `success` made a 401 render as a transport failure ("Status
        // Code 0 Error") and mis-fire the auth-failure path.
        success: true,
        statusCode: result.statusCode,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body,
        ...(result.bodyIsBase64 ? { bodyIsBase64: true } : {}),
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
   * SERVER MODE: start hosting this request as a local HTTP mock. restorm
   * LISTENS on `localhost:<port><path>` for the request's METHOD + PATH and
   * answers every matching inbound request with the configured response
   * (status/headers/body), resolved through ContextService — i.e. Handlebars
   * `{{var}}` substituted AT SERVE TIME — until {@link stopListening}. A
   * non-matching path/method on the port 404s.
   *
   * The shared per-port server lives in {@link WebSocketExecutionService} (one
   * OS socket per port across protocols), so an HTTP mock and a Socket.IO / raw
   * WS server can bind the SAME port. This method owns only the HTTP envelope:
   * route address, the served-response shape, request recording + the served
   * count broadcast.
   */
  async listen(requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> {
    const fullData = contextService.getRequestContext(requestId)?.fullData
    const method = (fullData?.method ?? 'GET').toUpperCase()
    const { port, path } = this.parseMockAddress(fullData?.url ?? '')
    if (!Number.isFinite(port) || port <= 0) {
      return { success: false, listening: false, error: 'A valid localhost port is required for an HTTP mock server' }
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    const result = await websocketExecutionService.listenHttpServer({
      requestId,
      method,
      port,
      path,
      onRequest: (req, res) => { this.serveMockResponse(requestId, req, res) },
      // The route stopped (Stop button / file close / quit): clear the served
      // count + broadcast on the HTTP progress channel so the request panel's
      // Listen↔Stop toggle flips back.
      onStopped: (error) => {
        this.servedCounts.delete(requestId)
        this.broadcastProgress(requestId, error ? 'error' : 'completed')
      }
    })

    if (!result.listening) {
      this.servedCounts.delete(requestId)
      this.broadcastProgress(requestId, 'error')
    }
    return result
  }

  /**
   * SCENARIO server node ({@link httpListenExecutor}): HOST this request's HTTP
   * mock as a LONG-LIVED listener and bridge it to the scheduler's connect
   * machinery (`SocketioConnHandle`). A DISTINCT path from the one-shot request
   * execution — `connect` = listen, each served request re-emits via `onMessage`
   * (→ the `served` port), `close` = stop the server (→ the node's `done`). Stays
   * up until `close()` (an httpClose node) or a Stop, exactly like a WS server.
   */
  connectStreamingHttpServer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const fullData = contextService.getRequestContext(requestId)?.fullData
    const method = (fullData?.method ?? 'GET').toUpperCase()
    const { port, path } = this.parseMockAddress(fullData?.url ?? '')
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      this.servedCounts.delete(requestId)
      this.broadcastProgress(requestId, error ? 'error' : 'completed')
      input.onClose(error)
    }

    if (!Number.isFinite(port) || port <= 0) {
      // Synchronous failure: report it as a close-on-error (the scheduler handles
      // a sync onClose during the bridge call).
      queueMicrotask(() => { fireClose('A valid localhost port is required for an HTTP mock server') })
      return { send: () => false, close: () => { fireClose() }, isOpen: () => false }
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    void websocketExecutionService.listenHttpServer({
      requestId,
      method,
      port,
      path,
      onRequest: (req, res) => {
        const summary = this.serveMockResponse(requestId, req, res)
        // Re-emit each served request on the node's `served` output.
        input.onMessage(undefined, summary)
      },
      onStopped: (error) => { fireClose(error) }
    }).then((result) => {
      if (result.listening) input.onConnect()
      else fireClose(result.error ?? `failed to start HTTP mock server for ${requestId}`)
    }).catch((err: unknown) => { fireClose(err instanceof Error ? err.message : String(err)) })

    return {
      // A hosted HTTP mock never SENDS unprompted — it only answers inbound
      // requests — so `send` is a no-op (there is no httpSend node).
      send: () => false,
      close: () => { this.stopListening(requestId) },
      isOpen: () => this.isListening(requestId)
    }
  }

  /** Stop hosting this request's HTTP mock route (the Stop button). Frees the
   * shared port once it was the last route. Idempotent. */
  stopListening(requestId: string): boolean {
    this.servedCounts.delete(requestId)
    return websocketExecutionService.disconnect(requestId)
  }

  /** Whether this request is currently hosting an HTTP mock route. */
  isListening(requestId: string): boolean {
    return websocketExecutionService.isActive(requestId)
  }

  /** Split a mock address (`localhost:<port><path>`, optional scheme) into its
   * numeric port + pathname. The path defaults to `/` and the query is dropped
   * (route matching is on the pathname only). */
  private parseMockAddress(raw: string): { port: number; path: string } {
    const stripped = raw.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const authority = slash >= 0 ? stripped.slice(0, slash) : stripped
    let path = slash >= 0 ? stripped.slice(slash) : '/'
    const q = path.indexOf('?')
    if (q >= 0) path = path.slice(0, q)
    if (path.length === 0) path = '/'
    const colon = authority.lastIndexOf(':')
    const port = colon >= 0 ? Number.parseInt(authority.slice(colon + 1), 10) : NaN
    return { port, path }
  }

  /** Resolve + write the configured mock response for one inbound request, then
   * record the hit + bump the served count. Status comes from `mockStatus`
   * (default 200); headers + body are resolved through ContextService so any
   * `{{var}}` is substituted at serve time (the protocol playbook hard-rule). */
  private serveMockResponse(requestId: string, req: IncomingMessage, res: ServerResponse): ServedSummary {
    const requestContext = contextService.getRequestContext(requestId)
    const fullData = requestContext?.fullData
    const status = fullData?.mockStatus ?? 200

    // Resolve headers (type-aware, like the client Send path): only expression
    // rows are Handlebars-substituted; verbatim string rows ship as-is.
    const headers: Record<string, string> = {}
    const headersGroup = requestContext?.keyValueGroups.get('headers')
    if (headersGroup) {
      for (const h of headersGroup) {
        if (h.enabled === false || !h.key) continue
        headers[h.key] = contextService.resolveKeyValueForRequest(h, requestId)
      }
    }

    // Resolve the body: any body with stored content is Handlebars-resolved at
    // serve time, so `{{var}}` substitutes from the active environment.
    let body = ''
    if (fullData?.body) {
      const bodyData = fullData.body
      // A `text` body's content is Handlebars-resolved at serve time. Other body
      // kinds (form-data / file) are not meaningful for a mock response.
      if (bodyData.type === 'text' && bodyData.content) {
        body = contextService.resolveValue(bodyData.content, requestId)
      }
    }

    if (!res.headersSent) res.writeHead(status, headers)
    res.end(body)

    const served = (this.servedCounts.get(requestId) ?? 0) + 1
    this.servedCounts.set(requestId, served)
    this.broadcastServed(requestId, served)
    logger.info('[HTTPExecutionService] mock served', { requestId, method: req.method, url: req.url, status, served })
    // The served summary feeds the scenario `httpListen` node's `served` output
    // (a hosted mock has no `response` output — it serves, it does not call out).
    return {
      request: { method: req.method ?? '', url: req.url ?? '', headers: flattenIncomingHeaders(req.headers) },
      response: { status, headers, body }
    }
  }

  /** Broadcast the HTTP mock's served-request count to the renderer — the
   * request panel shows "served N requests" while listening. */
  private broadcastServed(requestId: string, count: number): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('http:server-served', { requestId, count })
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
   * Make the actual HTTP request, following redirects and storing /
   * re-sending session cookies. Returns the FINAL response after any
   * redirect chain. The single-hop transport lives in `dispatchOnce`;
   * this wrapper owns the cross-hop policy (redirect following,
   * cookie jar) so both stay testable in isolation.
   */
  private async makeRequest(options: {
    url: URL
    method: string
    headers: Record<string, string>
    body?: string | Buffer
    timeout: number
    signal: AbortSignal
    followRedirects?: boolean
  }): Promise<{ statusCode: number; statusText: string; headers: Record<string, string | string[]>; body: string; bodyIsBase64?: boolean }> {
    const { followRedirects = true } = options
    const MAX_REDIRECTS = 10

    let currentUrl = options.url
    let currentMethod = options.method
    let currentBody = options.body
    // Per-hop header copy so we can drop the body headers when a 303 /
    // 302-on-POST collapses the method to GET, and refresh the Cookie
    // header for each origin in the chain.
    let currentHeaders: Record<string, string> = { ...options.headers }

    for (let hop = 0; ; hop++) {
      // Attach any stored cookies for this origin (re-sent across
      // requests in the session). A user-supplied Cookie header wins.
      this.applyCookies(currentUrl, currentHeaders)

      const response = await this.dispatchOnce({
        url: currentUrl,
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        timeout: options.timeout,
        signal: options.signal,
        // Bypass the firewall on the user-initiated request (hop 0) AND
        // the first redirect (hop 1) — a single redirect is legitimate
        // and should be friction-free. From the SECOND redirect onward
        // (hop >= 2) the target is increasingly server-controlled, so the
        // firewall vets each one normally (classify -> prompt; the user
        // can consciously whitelist it, never hard-blocked) to prevent
        // SSRF via a hostile Location (cloud-metadata, localhost, RFC1918).
        bypassFirewall: hop <= 1
      })

      // Store any Set-Cookie the server returned for this origin.
      this.storeCookies(currentUrl, response.headers['set-cookie'])

      const isRedirect = response.statusCode >= 300 && response.statusCode < 400
      const locationRaw = response.headers.location
      const location = Array.isArray(locationRaw) ? locationRaw[0] : locationRaw

      if (!followRedirects || !isRedirect || !location) {
        // Strip Set-Cookie from the surfaced headers? No — keep them so
        // the user can SEE what was set; the jar already captured them.
        return response
      }

      // Too many redirects: stop and surface an explicit, user-facing error
      // (a probable redirect loop) rather than silently truncating the chain
      // and returning a confusing 3xx. `execute()`'s catch turns this into a
      // `{ success: false, error }` response the UI shows as a request error.
      if (hop >= MAX_REDIRECTS) {
        throw new Error(`Too many redirects (max ${MAX_REDIRECTS}) — possible redirect loop`)
      }

      // Resolve the next URL (Location may be relative).
      let nextUrl: URL
      try {
        nextUrl = new URL(location, currentUrl)
      } catch {
        return response
      }

      // 303 (and, by widespread convention, 301/302 on POST) collapse
      // the follow-up to GET and drop the request body. 307/308
      // preserve the method + body verbatim.
      const code = response.statusCode
      if (code === 303 || ((code === 301 || code === 302) && currentMethod !== 'GET' && currentMethod !== 'HEAD')) {
        currentMethod = 'GET'
        currentBody = undefined
        // Drop body-shaped headers so the GET doesn't carry a stale
        // Content-Type / Content-Length.
        currentHeaders = this.stripBodyHeaders(currentHeaders)
      }

      currentUrl = nextUrl
    }
  }

  /** Apply stored session cookies for `url`'s origin to `headers`
   * (does not overwrite a user-supplied Cookie header). */
  private applyCookies(url: URL, headers: Record<string, string>): void {
    const hasCookie = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')
    if (hasCookie) return
    const jar = this.cookieJar.get(this.originKey(url))
    if (!jar || jar.size === 0) return
    headers['Cookie'] = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
  }

  /** Store `Set-Cookie` values from a response into the session jar,
   * keyed by the response origin. */
  private storeCookies(url: URL, setCookie: string | string[] | undefined): void {
    if (!setCookie) return
    const values = Array.isArray(setCookie) ? setCookie : [setCookie]
    const key = this.originKey(url)
    let jar = this.cookieJar.get(key)
    if (!jar) {
      jar = new Map<string, string>()
      this.cookieJar.set(key, jar)
    }
    for (const raw of values) {
      // The cookie pair is the first `;`-separated segment; the rest are
      // attributes (Path, HttpOnly, …) we don't need for re-send.
      const pair = raw.split(';')[0]
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (name) jar.set(name, value)
    }
  }

  /** Origin key (`scheme://host:port`) for cookie scoping. */
  private originKey(url: URL): string {
    return `${url.protocol}//${url.host}`
  }

  /** Drop Content-Type / Content-Length when a redirect collapses to GET. */
  private stripBodyHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase()
      if (lower === 'content-type' || lower === 'content-length') continue
      out[k] = v
    }
    return out
  }

  /** Clear the session cookie jar (called when a new collection opens). */
  clearCookies(): void {
    this.cookieJar.clear()
  }

  /**
   * Dispatch a single HTTP hop (no redirect following). Preserves
   * binary response bodies by detecting non-text Content-Type / bytes
   * and base64-encoding them (`bodyIsBase64`) instead of corrupting
   * them through a UTF-8 decode.
   */
  private dispatchOnce(options: {
    url: URL
    method: string
    headers: Record<string, string>
    body?: string | Buffer
    timeout: number
    signal: AbortSignal
    bypassFirewall: boolean
  }): Promise<{ statusCode: number; statusText: string; headers: Record<string, string | string[]>; body: string; bodyIsBase64?: boolean }> {
    // `bypassFirewall` is decided by the caller (`makeRequest`): the
    // user-initiated request and the first redirect are bypassed (the
    // Send-button dispatch is the same trust tier as a URL pasted into
    // Import / typed into the mini-browser, so the firewall short-circuits
    // to `allow` rather than re-prompting for a Send the user already
    // clicked, or hanging silently on a non-whitelisted origin the
    // main-process intercept path can't surface a toast for). When
    // `bypassFirewall` is false (a 2nd+ redirect), the target is
    // server-controlled and could point at cloud-metadata (169.254.169.254),
    // localhost, or an RFC1918 address (SSRF), so it is vetted by the
    // firewall normally; the user can still allow it via the prompt.
    const dispatch = (): Promise<{ statusCode: number; statusText: string; headers: Record<string, string | string[]>; body: string; bodyIsBase64?: boolean }> => new Promise((resolve, reject) => {
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
        let received = 0

        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received > MAX_RESPONSE_BYTES) {
            // Bound main-process memory: destroy the socket and reject
            // rather than keep buffering an unbounded body.
            signal.removeEventListener('abort', abortHandler)
            request.destroy()
            reject(new Error(`Response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`))
            return
          }
          chunks.push(chunk)
        })

        response.on('end', () => {
          signal.removeEventListener('abort', abortHandler)
          const bodyBuffer = Buffer.concat(chunks)

          // Convert headers to plain object
          const responseHeaders: Record<string, string | string[]> = {}
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              responseHeaders[key] = value
            }
          }

          // Preserve binary bodies: a text response decodes to UTF-8 as
          // before; a binary one (by Content-Type or non-text bytes) is
          // base64-encoded so it round-trips intact to the renderer,
          // which offers a download rather than a corrupting text render.
          const contentTypeRaw = responseHeaders['content-type']
          const contentType = Array.isArray(contentTypeRaw) ? contentTypeRaw[0] : contentTypeRaw
          if (this.isBinaryResponse(contentType, bodyBuffer)) {
            resolve({
              statusCode: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: responseHeaders,
              body: bodyBuffer.toString('base64'),
              bodyIsBase64: true
            })
            return
          }

          resolve({
            statusCode: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: responseHeaders,
            body: bodyBuffer.toString('utf-8')
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

      if (body !== undefined) {
        request.write(body)
      }

      request.end()
    })

    return options.bypassFirewall ? withFirewallBypass(dispatch) : dispatch()
  }

  /**
   * Decide whether a response body should be preserved as binary.
   * Text-ish Content-Types (text/*, JSON, XML, form-encoded, SVG,
   * JS/CSS) stay UTF-8; everything else, or a body containing NUL /
   * a high ratio of non-printable bytes, is treated as binary.
   */
  private isBinaryResponse(contentType: string | undefined, buffer: Buffer): boolean {
    if (buffer.length === 0) return false
    const ct = (contentType ?? '').toLowerCase()
    if (ct) {
      const isText =
        ct.startsWith('text/') ||
        ct.includes('json') ||
        ct.includes('xml') ||
        ct.includes('javascript') ||
        ct.includes('ecmascript') ||
        ct.includes('css') ||
        ct.includes('csv') ||
        ct.includes('x-www-form-urlencoded') ||
        ct.includes('svg') ||
        ct.includes('x-ndjson')
      if (isText) return false
      // A declared non-text type (image/*, application/octet-stream,
      // application/pdf, font/*, audio/*, video/*, …) → binary.
      return true
    }
    // No Content-Type: sniff. A NUL byte in the first 8KB is a strong
    // binary signal (text never contains NUL).
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
    return sample.includes(0)
  }

  /**
   * Build a `multipart/form-data` request body from the resolved
   * fields. A field whose resolved value is an existing file path is
   * streamed as a file part (filename + best-effort Content-Type);
   * every other field is a plain text part. Returns the assembled
   * buffer and the generated boundary.
   */
  private buildMultipartBody(
    fields: import('../../shared/types/collections').KeyValue[],
    requestId: string
  ): { buffer: Buffer; boundary: string } {
    const boundary = `----restormFormBoundary${randomBytes(16).toString('hex')}`
    const parts: Buffer[] = []
    const CRLF = '\r\n'

    for (const field of fields) {
      if (!field.key) continue
      if (field.enabled === false) continue
      const key = contextService.resolveValue(field.key, requestId)
      const rawValue = typeof field.value === 'string' ? field.value : field.value.toString()
      const value = contextService.resolveValue(rawValue, requestId)

      // A value that resolves to an existing file path becomes a file
      // part (this is how a `form-data` field uploads a file, e.g.
      // Petstore `/pet/{id}/uploadImage` with field `file`).
      if (value && fs.existsSync(value) && fs.statSync(value).isFile()) {
        const fileBuf = fs.readFileSync(value)
        const filename = basename(value)
        const contentType = this.guessFileContentType(filename)
        parts.push(Buffer.from(
          `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${key}"; filename="${filename}"${CRLF}` +
          `Content-Type: ${contentType}${CRLF}${CRLF}`,
          'utf-8'
        ))
        parts.push(fileBuf)
        parts.push(Buffer.from(CRLF, 'utf-8'))
      } else {
        parts.push(Buffer.from(
          `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}` +
          `${value}${CRLF}`,
          'utf-8'
        ))
      }
    }
    parts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf-8'))
    return { buffer: Buffer.concat(parts), boundary }
  }

  /** Best-effort Content-Type for a multipart file part by extension. */
  private guessFileContentType(filename: string): string {
    const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      svg: 'image/svg+xml', webp: 'image/webp', pdf: 'application/pdf',
      json: 'application/json', xml: 'application/xml', txt: 'text/plain',
      csv: 'text/csv', html: 'text/html', zip: 'application/zip',
      bin: 'application/octet-stream'
    }
    return map[ext] ?? 'application/octet-stream'
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
    // objects instead of `StringValue` / `SecretValue` instances;
    // `.toString()` on those returns `[object Object]`.
    const extractString = (v: unknown): string => {
      if (typeof v === 'string') return v
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      if (v && typeof v === 'object') {
        const obj = v as { toString?: () => string; value?: unknown }
        if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
          // Class instances (`StringValue`, `SecretValue`, …) still
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
        // IPC marshal turns every `StringValue` / `SecretValue` /
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
    // Record the auth (login) call in the LOGIN route's OWN response history —
    // the same place a user-sent request lands. The auth sub-call goes on the
    // wire here directly (it never passes through the request IPC handler that
    // normally calls `storeExecutionResult`), so without this the login route's
    // history stayed empty even though it was really called. We record EVERY
    // outcome (success, HTTP error, or transport failure) so the route's
    // history mirrors what the user saw (the key's pulse fires on every
    // attempt). Fire-and-forget off the hot path — a history-write hiccup must
    // never break the auth flow.
    const recordAuthHistory = (authResult: HTTPExecutionResult): void => {
      setImmediate(() => {
        void responseHistoryService.storeExecutionResult(authRequest.id, 'http', authResult)
      })
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(shape.url)
    } catch {
      const invalid: HTTPExecutionResult = {
        requestId: authRequest.id,
        success: false,
        error: `Invalid auth URL: ${shape.url}`,
        requestUrl: shape.url,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
      recordAuthHistory(invalid)
      return invalid
    }
    let result: Awaited<ReturnType<HTTPExecutionService['makeRequest']>>
    try {
      result = await this.makeRequest({
        url: parsedUrl,
        method: shape.method,
        headers: shape.headers,
        ...(shape.body !== undefined ? { body: shape.body } : {}),
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
        signal: parentSignal
      })
    } catch (err) {
      // Transport failure (connection refused, timeout, firewall block, …).
      // Record the failed attempt, then rethrow so the auth cache marks the
      // refresh failed and the downstream request aborts as before.
      recordAuthHistory({
        requestId: authRequest.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        requestUrl: shape.url,
        timings: { startedAt, durationMs: Date.now() - startTime }
      })
      throw err
    }
    const durationMs = Date.now() - startTime
    const authResult: HTTPExecutionResult = {
      requestId: authRequest.id,
      success: true,
      statusCode: result.statusCode,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      requestUrl: shape.url,
      timings: { startedAt, durationMs }
    }
    recordAuthHistory(authResult)
    return authResult
  }
}

/** Singleton instance */
export const httpExecutionService = new HTTPExecutionService()
