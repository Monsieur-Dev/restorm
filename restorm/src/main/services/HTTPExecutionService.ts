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
import { authenticationCacheService } from './AuthenticationCacheService'
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
              // Resolve header value using environment context
              const resolvedValue = contextService.resolveValue(h.value, requestId)
              headers[h.key] = resolvedValue
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
        if (bodyData.type === 'text') {
          body = contextService.resolveValue(bodyData.content, requestId)
        } else if (bodyData.type === 'x-www-form-urlencoded') {
          const params = new URLSearchParams()
          for (const field of bodyData.fields) {
            if (field.key) {
              const resolvedKey = contextService.resolveValue(field.key, requestId)
              const resolvedValue = contextService.resolveValue(field.value, requestId)
              params.append(resolvedKey, resolvedValue)
            }
          }
          body = params.toString()
          headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
        }
        // Note: form-data and file modes require special handling
      }

      // Inject auth headers (fresh or cached) before dispatching.
      if (authRequest) {
        try {
          const authHeaders = await authenticationCacheService.getHeaders(
            authRequest,
            (r) => this.executeAuthInner(r, abortController.signal)
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
      if (authRequest?.authErrorCodes.includes(result.statusCode)) {
        authenticationCacheService.invalidate(authRequest.id)
        try {
          const refreshed = await authenticationCacheService.refresh(
            authRequest,
            (r) => this.executeAuthInner(r, abortController.signal)
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
  private async executeAuthInner(
    authRequest: AuthenticationRequest,
    parentSignal: AbortSignal
  ): Promise<HTTPExecutionResult> {
    const startTime = Date.now()
    const startedAt = new Date().toISOString()
    // Prefer the ContextService-resolved URL if the request has been
    // registered (its id was seen by `contextService.registerRequest`).
    // Otherwise fall back to the URL on the auth request itself.
    const resolvedUrl = contextService.getResolvedUrl(authRequest.id)?.resolvedUrl ?? authRequest.url
    if (!resolvedUrl) {
      return {
        requestId: authRequest.id,
        success: false,
        error: 'Auth request has no URL',
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(resolvedUrl)
    } catch {
      return {
        requestId: authRequest.id,
        success: false,
        error: `Invalid auth URL: ${resolvedUrl}`,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    // Build headers — ContextService for the registered path,
    // raw auth-request headers otherwise.
    const headers: Record<string, string> = {}
    const authCtx = contextService.getRequestContext(authRequest.id)
    const headerSource = authCtx?.keyValueGroups.get('headers') ?? authRequest.headers
    for (const h of headerSource) {
      if (h.enabled === false) continue
      if (!h.key) continue
      const rawValue = h.value.toString()
      const resolved = authCtx
        ? contextService.resolveValue(rawValue, authRequest.id)
        : rawValue
      headers[h.key] = resolved
    }

    // Build body.
    let body: string | undefined
    if (authCtx?.fullData?.body) {
      const bodyData = authCtx.fullData.body
      if (bodyData.type === 'text') {
        body = contextService.resolveValue(bodyData.content, authRequest.id)
      } else if (bodyData.type === 'x-www-form-urlencoded') {
        const params = new URLSearchParams()
        for (const field of bodyData.fields) {
          if (!field.key) continue
          const k = contextService.resolveValue(field.key, authRequest.id)
          const v = contextService.resolveValue(field.value, authRequest.id)
          params.append(k, v)
        }
        body = params.toString()
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded'
      }
    } else if (authRequest.body?.type === 'text' && authRequest.body.content) {
      body = authRequest.body.content
    }

    const result = await this.makeRequest({
      url: parsedUrl,
      method: authRequest.method,
      headers,
      body,
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
      requestUrl: resolvedUrl,
      timings: { startedAt, durationMs }
    }
  }
}

/** Singleton instance */
export const httpExecutionService = new HTTPExecutionService()
