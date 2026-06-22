/**
 * SOAP Execution Service
 * Handles SOAP request execution in the main process with cancel support
 */

import http from 'http'
import https from 'https'
import type { IncomingMessage, ServerResponse } from 'http'
import { URL } from 'url'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { websocketExecutionService } from './WebSocketExecutionService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_REQUEST_TIMEOUT_MS, MAX_RESPONSE_BYTES } from '../../shared/config/constants'
import { XMLParser } from 'fast-xml-parser'
import { resolveSoapOperation, buildSoapResponse, buildUnmatchedFault, firstBodyOperationName, normalizeSoapAction } from '../../shared/soapMockDispatch'
import type { SoapMockOperation } from '../../shared/types/requests/SoapRequest'

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

/** One served SOAP-mock request, surfaced on a scenario `soapListen` node's
 * `served` output (shape mirrors the HTTP mock's served summary so a JSON-path
 * picker drills it the same way). */
interface ServedSummary {
  request: { soapAction: string; operation: string; url: string; body: string }
  response: { status: number; body: string; fault: boolean }
}

/** Read a single inbound header value (case-insensitive), flattening an array. */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()]
  if (raw === undefined) return undefined
  return Array.isArray(raw) ? raw[0] : raw
}

/** Read a request body to a UTF-8 string, capped at the shared response limit. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_RESPONSE_BYTES) {
        req.destroy()
        reject(new Error(`Request exceeded the ${MAX_RESPONSE_BYTES}-byte limit`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf-8')) })
    req.on('error', reject)
  })
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
  /** Per-request served-request counter for hosted SOAP mock routes (server
   * mode). Drives the "served N requests" banner. */
  private servedCounts = new Map<string, number>()

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

  // --------------------------------------------------------------------------
  // SERVER MODE — host a local SOAP mock (server === true).
  //
  // SOAP-over-HTTP, so this reuses the shared per-port HTTP dispatcher in
  // {@link WebSocketExecutionService} (one OS socket per port; an HTTP route and
  // a SOAP route can coexist on the same port). This service owns only the SOAP
  // envelope: operation dispatch (SOAPAction / body operation), the canned-XML /
  // `<soap:Fault>` serialization, request recording + the served count.
  // --------------------------------------------------------------------------

  /**
   * Request panel "Listen" button: HOST this request's SOAP mock on
   * `localhost:<port><path>` and answer every inbound POST by dispatching to the
   * matching configured operation, until {@link stopListening}. A non-matching
   * path/method on the port 404s; an unmatched operation answers a `<soap:Fault>`.
   */
  async listen(requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> {
    const fullData = contextService.getRequestContext(requestId)?.fullData
    const { port, path } = this.parseMockAddress(fullData?.url ?? '')
    if (!Number.isFinite(port) || port <= 0) {
      return { success: false, listening: false, error: 'A valid localhost port is required for a SOAP mock server' }
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    const result = await websocketExecutionService.listenHttpServer({
      requestId,
      method: 'POST',
      port,
      path,
      onRequest: (req, res) => { void this.serveMockResponse(requestId, req, res) },
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
   * SCENARIO server node ({@link soapListenExecutor}): HOST this request's SOAP
   * mock as a LONG-LIVED listener and bridge it to the scheduler's connect
   * machinery (mirrors {@link HTTPExecutionService.connectStreamingHttpServer}).
   * `connect` = listen, each served request re-emits via `onMessage` (→ the
   * `served` port), `close` = stop the server (→ the node's `done`).
   */
  connectStreamingSoapServer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const fullData = contextService.getRequestContext(requestId)?.fullData
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
      queueMicrotask(() => { fireClose('A valid localhost port is required for a SOAP mock server') })
      return { send: () => false, close: () => { fireClose() }, isOpen: () => false }
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    void websocketExecutionService.listenHttpServer({
      requestId,
      method: 'POST',
      port,
      path,
      onRequest: (req, res) => {
        void this.serveMockResponse(requestId, req, res).then((summary) => {
          if (summary) input.onMessage(undefined, summary)
        })
      },
      onStopped: (error) => { fireClose(error) }
    }).then((result) => {
      if (result.listening) input.onConnect()
      else fireClose(result.error ?? `failed to start SOAP mock server for ${requestId}`)
    }).catch((err: unknown) => { fireClose(err instanceof Error ? err.message : String(err)) })

    return {
      // A hosted SOAP mock never SENDS unprompted — it only answers inbound
      // requests — so `send` is a no-op (there is no soapSend node).
      send: () => false,
      close: () => { this.stopListening(requestId) },
      isOpen: () => this.isListening(requestId)
    }
  }

  /** Stop hosting this request's SOAP mock route (the Stop button). Frees the
   * shared port once it was the last route. Idempotent. */
  stopListening(requestId: string): boolean {
    this.servedCounts.delete(requestId)
    return websocketExecutionService.disconnect(requestId)
  }

  /** Whether this request is currently hosting a SOAP mock route. */
  isListening(requestId: string): boolean {
    return websocketExecutionService.isActive(requestId)
  }

  /** Split a mock address (`localhost:<port><path>`, optional scheme) into its
   * numeric port + pathname. The path defaults to `/` and the query is dropped. */
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

  /** Resolve + write the mock SOAP response for one inbound request, then record
   * the hit + bump the served count. Reads the configured `mockOperations` from
   * the request context, dispatches by SOAPAction / body operation, and answers
   * the canned envelope (`<soap:Fault>` + HTTP 500 for a fault operation). */
  private async serveMockResponse(requestId: string, req: IncomingMessage, res: ServerResponse): Promise<ServedSummary | undefined> {
    let inboundBody = ''
    try {
      inboundBody = await readBody(req)
    } catch (err) {
      logger.warn('[SOAPExecutionService] failed to read inbound mock body', { requestId, error: err instanceof Error ? err.message : String(err) })
    }

    const operations = this.mockOperationsFor(requestId)
    const soapActionHeader = normalizeSoapAction(headerValue(req, 'soapaction'))
    const op = resolveSoapOperation(operations, { soapAction: soapActionHeader, body: inboundBody })

    const requestedOperation = soapActionHeader ?? firstBodyOperationName(inboundBody)
    const { status, xml } = op ? buildSoapResponse(op) : buildUnmatchedFault(requestedOperation)

    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' })
    res.end(xml)

    const served = (this.servedCounts.get(requestId) ?? 0) + 1
    this.servedCounts.set(requestId, served)
    this.broadcastServed(requestId, served)
    logger.info('[SOAPExecutionService] mock served', { requestId, operation: op?.name ?? requestedOperation ?? '(unmatched)', status, served })

    return {
      request: { soapAction: soapActionHeader ?? '', operation: requestedOperation ?? '', url: req.url ?? '', body: inboundBody },
      response: { status, body: xml, fault: !op || op.isFault === true }
    }
  }

  /** The configured mock operations for a request, read from its full context. */
  private mockOperationsFor(requestId: string): SoapMockOperation[] {
    const fullData = contextService.getRequestContext(requestId)?.fullData
    return fullData?.soapMockOperations ?? []
  }

  /** Broadcast the SOAP mock's served-request count to the renderer — the
   * request panel shows "served N requests" while listening. */
  private broadcastServed(requestId: string, count: number): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('soap:server-served', { requestId, count })
    }
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
