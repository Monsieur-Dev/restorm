/**
 * SOAP Execution Service
 * Handles SOAP request execution in the main process with cancel support
 */

import http from 'http'
import https from 'https'
import { URL } from 'url'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../shared/config/constants'

/** SOAP request execution input */
export interface SOAPExecutionInput {
  requestId: string
  timeout?: number
}

/** SOAP fault */
interface SOAPFault {
  code: string
  message: string
}

/** SOAP response result */
export interface SOAPExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  responseBody?: string
  headers?: Record<string, string | string[]>
  fault?: SOAPFault
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
 * Parse SOAP fault from response
 */
function parseSoapFault(xml: string): SOAPFault | undefined {
  const faultMatch = /<(?:\w+:)?Fault[^>]*>([\s\S]*?)<\/(?:\w+:)?Fault>/i.exec(xml)
  if (!faultMatch?.[1]) return undefined
  
  const faultContent = faultMatch[1]
  
  const codeMatch = /<(?:\w+:)?faultcode[^>]*>([\s\S]*?)<\/(?:\w+:)?faultcode>/i.exec(faultContent)
  const messageMatch = /<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i.exec(faultContent)
  
  return {
    code: codeMatch?.[1]?.trim() ?? 'Unknown',
    message: messageMatch?.[1]?.trim() ?? 'Unknown error'
  }
}

/**
 * Service for executing SOAP requests in the main process
 */
class SOAPExecutionService {
  private activeRequests = new Map<string, ActiveRequest>()

  /**
   * Execute a SOAP request using the resolved URL and data from ContextService
   */
  async execute(input: SOAPExecutionInput): Promise<SOAPExecutionResult> {
    const { requestId, timeout = DEFAULT_REQUEST_TIMEOUT_MS } = input
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
    logger.info('[SOAPExecutionService] Executing request', { requestId, url: resolvedUrl })

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
      const headers: Record<string, string> = {
        'Content-Type': 'text/xml; charset=utf-8'
      }
      
      // Add SOAPAction header if available
      const soapAction = requestContext?.fullData?.soapAction
      if (soapAction) {
        headers['SOAPAction'] = contextService.resolveValue(soapAction, requestId)
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
              // Type-aware: see `HTTPExecutionService`.
              headers[h.key] = contextService.resolveKeyValueForRequest(h, requestId)
            }
          }
        }
      }

      // Build SOAP body
      let body = ''
      if (requestContext?.fullData?.soapBody) {
        body = contextService.resolveValue(requestContext.fullData.soapBody, requestId)
      } else if (requestContext?.fullData?.body) {
        if (typeof requestContext.fullData.body === 'string') {
          body = contextService.resolveValue(requestContext.fullData.body, requestId)
        } else if (requestContext.fullData.body.content) {
          body = contextService.resolveValue(requestContext.fullData.body.content as string, requestId)
        }
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

      // Check for SOAP fault
      const fault = parseSoapFault(result.body)

      return {
        requestId,
        success: !fault && result.statusCode >= 200 && result.statusCode < 300,
        statusCode: result.statusCode,
        responseBody: result.body,
        headers: result.headers,
        fault,
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
      logger.info('[SOAPExecutionService] Cancelling request', { requestId })
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
      win.webContents.send('soap:request-progress', { requestId, status })
    }
  }
}

/** Singleton instance */
export const soapExecutionService = new SOAPExecutionService()
