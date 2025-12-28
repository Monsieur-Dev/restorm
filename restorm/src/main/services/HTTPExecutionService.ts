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

/** HTTP request execution input */
export interface HTTPExecutionInput {
  requestId: string
  method: string
  timeout?: number
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
    const { requestId, method, timeout = 30000 } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    // Get resolved URL from ContextService
    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      return {
        requestId,
        success: false,
        error: 'No resolved URL found for this request. Make sure the request is registered.',
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    const resolvedUrl = urlResult.resolvedUrl
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

      // Build headers from context
      const headers: Record<string, string> = {}
      if (requestContext?.keyValueGroups) {
        const headersGroup = requestContext.keyValueGroups.get('headers')
        if (headersGroup) {
          for (const h of headersGroup) {
            if (h.key) {
              // Resolve header value using environment context
              const resolvedValue = contextService.resolveValue(h.value, requestId)
              headers[h.key] = resolvedValue
            }
          }
        }
      }

      // Build body from context
      let body: string | undefined
      if (requestContext?.fullData?.body) {
        const bodyData = requestContext.fullData.body
        if (bodyData.type === 'text' && bodyData.content) {
          body = contextService.resolveValue(bodyData.content, requestId)
        } else if (bodyData.type === 'x-www-form-urlencoded' && bodyData.fields) {
          const params = new URLSearchParams()
          for (const field of bodyData.fields) {
            if (field.key) {
              const resolvedKey = contextService.resolveValue(field.key, requestId)
              const resolvedValue = contextService.resolveValue(field.value, requestId)
              params.append(resolvedKey, resolvedValue)
            }
          }
          body = params.toString()
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
          }
        }
        // Note: form-data and file modes require special handling
      }

      // Execute request
      const result = await this.makeRequest({
        url: parsedUrl,
        method: method.toUpperCase(),
        headers,
        body,
        timeout,
        signal: abortController.signal
      })

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
}

/** Singleton instance */
export const httpExecutionService = new HTTPExecutionService()

