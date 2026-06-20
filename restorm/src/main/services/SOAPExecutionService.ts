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
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_REQUEST_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../../shared/config/constants'
import { XMLParser } from 'fast-xml-parser'

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
 * Parse a SOAP fault from a response body.
 *
 * Handles BOTH SOAP versions via a real XML parse (so namespace prefixes and
 * entity-encoded text decode correctly, which the old regex did not):
 *  - SOAP 1.1: `<Fault>` with `<faultcode>` / `<faultstring>`
 *  - SOAP 1.2: `<Fault>` with `<Code><Value>` / `<Reason><Text>`
 * Returns undefined when the body parses but carries no Fault element.
 */
export function parseSoapFault(xml: string): SOAPFault | undefined {
  let tree: unknown
  try {
    tree = new XMLParser({
      ignoreAttributes: true,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true
    }).parse(xml)
  } catch {
    return undefined
  }

  const fault = findNode(tree, 'Fault')
  if (fault === undefined || fault === null) return undefined
  if (typeof fault !== 'object') {
    // A bare `<Fault>text</Fault>` — surface what we have.
    return { code: 'Unknown', message: scalar(fault) ?? 'Unknown error' }
  }

  const node = fault as Record<string, unknown>
  // SOAP 1.1
  const faultcode = scalar(node.faultcode)
  const faultstring = scalar(node.faultstring)
  // SOAP 1.2: Code/Value (Value may itself be nested) and Reason/Text.
  const code12 = scalar(findNode(node.Code, 'Value') ?? node.Code)
  const reason12 = scalar(findNode(node.Reason, 'Text') ?? node.Reason)

  return {
    code: faultcode ?? code12 ?? 'Unknown',
    message: faultstring ?? reason12 ?? 'Unknown error'
  }
}

/** Coerce a parsed XML value to a trimmed string, or undefined. */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim()
    return t.length > 0 ? t : undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/** Depth-first search for the first node whose (NS-stripped) key matches `name`. */
function findNode(tree: unknown, name: string, depth = 0): unknown {
  if (depth > 64 || tree === null || typeof tree !== 'object') return undefined
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const hit = findNode(item, name, depth + 1)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const obj = tree as Record<string, unknown>
  if (name in obj) return obj[name]
  for (const value of Object.values(obj)) {
    const hit = findNode(value, name, depth + 1)
    if (hit !== undefined) return hit
  }
  return undefined
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
      // Resolve any SecretValues reachable from this request's KeyValue
      // groups AND from the active env-folder variable chain BEFORE the
      // synchronous resolution loop below.
      const envSecrets = contextService.collectEnvironmentSecrets(requestId)
      const secrets = [...collectRequestSecrets(requestContext?.keyValueGroups), ...envSecrets]
      let effectiveUrl = resolvedUrl
      if (secrets.length > 0) {
        await secretHydrationService.hydrate(requestId, secrets, abortController.signal)
        if (envSecrets.length > 0) {
          contextService.refreshEnvironmentContext(requestId)
          effectiveUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? resolvedUrl
        }
      }

      // Parse URL
      let parsedUrl: URL
      try {
        parsedUrl = new URL(effectiveUrl)
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
        let received = 0

        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received > MAX_RESPONSE_BYTES) {
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
