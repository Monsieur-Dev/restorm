/**
 * GraphQL Execution Service
 * Handles GraphQL request execution in the main process with cancel support
 */

import http from 'http'
import https from 'https'
import { URL } from 'url'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'

/** GraphQL request execution input */
export interface GraphQLExecutionInput {
  requestId: string
  timeout?: number
}

/** GraphQL response result */
export interface GraphQLExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  data?: unknown
  errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[]
  headers?: Record<string, string | string[]>
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
 * Service for executing GraphQL requests in the main process
 */
class GraphQLExecutionService {
  private activeRequests = new Map<string, ActiveRequest>()

  /**
   * Execute a GraphQL request using the resolved URL and data from ContextService
   */
  async execute(input: GraphQLExecutionInput): Promise<GraphQLExecutionResult> {
    const { requestId, timeout = 30000 } = input
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
    logger.info('[GraphQLExecutionService] Executing request', { requestId, url: resolvedUrl })

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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (requestContext?.keyValueGroups) {
        const headersGroup = requestContext.keyValueGroups.get('headers')
        if (headersGroup) {
          for (const h of headersGroup) {
            // Skip disabled headers (enabled defaults to true if undefined)
            if (h.enabled === false) {
              continue
            }
            if (h.key) {
              const resolvedValue = contextService.resolveValue(h.value, requestId)
              headers[h.key] = resolvedValue
            }
          }
        }
      }

      // Build GraphQL body from fullData
      let body: string
      if (requestContext?.fullData?.body && typeof requestContext.fullData.body === 'string') {
        // Body is already JSON string with query/variables
        body = contextService.resolveValue(requestContext.fullData.body, requestId)
      } else {
        // Fallback: try to construct from fullData
        const query = requestContext?.fullData?.query ?? ''
        const variables = requestContext?.fullData?.variables ?? '{}'
        let parsedVariables: Record<string, unknown> = {}
        try {
          const parsed = JSON.parse(variables) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedVariables = parsed as Record<string, unknown>
          }
        } catch {
          // Invalid JSON, use empty object
        }
        body = JSON.stringify({
          query,
          variables: Object.keys(parsedVariables).length > 0 ? parsedVariables : undefined
        })
      }

      // Execute request
      const result = await this.makeRequest({
        url: parsedUrl,
        headers,
        body,
        timeout,
        signal: abortController.signal
      })

      const durationMs = Date.now() - startTime
      
      // Broadcast completion
      this.broadcastProgress(requestId, 'completed')

      // Parse GraphQL response
      let data: unknown
      let errors: GraphQLExecutionResult['errors']
      try {
        const parsed = JSON.parse(result.body) as { data?: unknown; errors?: GraphQLExecutionResult['errors'] }
        data = parsed.data
        errors = parsed.errors
      } catch {
        // Not JSON, treat as error
        errors = [{ message: 'Invalid JSON response' }]
      }

      return {
        requestId,
        success: !errors || errors.length === 0,
        statusCode: result.statusCode,
        data,
        errors,
        headers: result.headers,
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
      logger.info('[GraphQLExecutionService] Cancelling request', { requestId })
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
    headers: Record<string, string>
    body: string
    timeout: number
    signal: AbortSignal
  }): Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: string }> {
    return new Promise((resolve, reject) => {
      const { url, headers, body, timeout, signal } = options
      
      const isHttps = url.protocol === 'https:'
      const httpModule = isHttps ? https : http

      const requestOptions: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout
      }

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

          const responseHeaders: Record<string, string | string[]> = {}
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              responseHeaders[key] = value
            }
          }

          resolve({
            statusCode: response.statusCode ?? 0,
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

      request.write(body)
      request.end()
    })
  }

  /**
   * Broadcast progress to renderer
   */
  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('graphql:request-progress', { requestId, status })
    }
  }
}

/** Singleton instance */
export const graphqlExecutionService = new GraphQLExecutionService()
