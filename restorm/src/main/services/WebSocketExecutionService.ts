/**
 * WebSocket Execution Service
 * Handles WebSocket connections in the main process with streaming support
 */

import WebSocket from 'ws'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'

/** WebSocket request execution input */
export interface WebSocketExecutionInput {
  requestId: string
  timeout?: number
}

/** WebSocket message */
export interface WebSocketMessage {
  direction: 'sent' | 'received'
  data: string
  event?: string
  timestamp: string
}

/** WebSocket response result */
export interface WebSocketExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  messages: WebSocketMessage[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** Active connection info */
interface ActiveConnection {
  requestId: string
  ws: WebSocket
  startTime: number
  messages: WebSocketMessage[]
}

/**
 * Service for executing WebSocket requests in the main process
 */
class WebSocketExecutionService {
  private activeConnections = new Map<string, ActiveConnection>()

  /**
   * Connect to a WebSocket endpoint and send a message
   */
  async execute(input: WebSocketExecutionInput): Promise<WebSocketExecutionResult> {
    const { requestId, timeout = 5000 } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    // Get resolved URL from ContextService
    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      return {
        requestId,
        success: false,
        connected: false,
        messages: [],
        error: 'No resolved URL found for this request. Make sure the request is registered.',
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    const resolvedUrl = urlResult.resolvedUrl
    logger.info('[WebSocketExecutionService] Connecting', { requestId, url: resolvedUrl })

    // Get request context
    const requestContext = contextService.getRequestContext(requestId)

    // Broadcast that connection started
    this.broadcastProgress(requestId, 'started')

    return new Promise((resolve) => {
      const messages: WebSocketMessage[] = []
      let connected = false

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
              const resolvedValue = contextService.resolveValue(h.value, requestId)
              headers[h.key] = resolvedValue
            }
          }
        }
      }

      // Get message and event from fullData
      const message = requestContext?.fullData?.message ?? '{}'
      const resolvedMessage = contextService.resolveValue(message, requestId)
      const event = requestContext?.fullData?.event

      try {
        const ws = new WebSocket(resolvedUrl, { headers })

        // Store active connection
        const connection: ActiveConnection = { requestId, ws, startTime, messages }
        this.activeConnections.set(requestId, connection)

        // Set timeout
        const timeoutId = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close()
          }
        }, timeout)

        ws.on('open', () => {
          connected = true
          logger.info('[WebSocketExecutionService] Connected', { requestId })

          // Send message
          const msgToSend = event ? JSON.stringify({ event, data: resolvedMessage }) : resolvedMessage
          ws.send(msgToSend)
          messages.push({
            direction: 'sent',
            data: resolvedMessage,
            event,
            timestamp: new Date().toISOString()
          })

          // Broadcast message to renderer
          this.broadcastMessage(requestId, messages[messages.length - 1])
        })

        ws.on('message', (data: WebSocket.Data) => {
          const msgStr = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : JSON.stringify(data)
          const msg: WebSocketMessage = {
            direction: 'received',
            data: msgStr,
            timestamp: new Date().toISOString()
          }
          messages.push(msg)
          
          // Broadcast message to renderer
          this.broadcastMessage(requestId, msg)
        })

        ws.on('close', () => {
          clearTimeout(timeoutId)
          const durationMs = Date.now() - startTime
          this.activeConnections.delete(requestId)
          
          this.broadcastProgress(requestId, 'completed')
          
          resolve({
            requestId,
            success: connected,
            connected,
            messages,
            requestUrl: resolvedUrl,
            timings: { startedAt, durationMs }
          })
        })

        ws.on('error', (err: Error) => {
          clearTimeout(timeoutId)
          const durationMs = Date.now() - startTime
          this.activeConnections.delete(requestId)
          
          this.broadcastProgress(requestId, 'error')
          
          resolve({
            requestId,
            success: false,
            connected,
            messages,
            error: err.message,
            requestUrl: resolvedUrl,
            timings: { startedAt, durationMs }
          })
        })
      } catch (err) {
        const durationMs = Date.now() - startTime
        const error = err as Error
        
        this.broadcastProgress(requestId, 'error')
        
        resolve({
          requestId,
          success: false,
          connected: false,
          messages: [],
          error: error.message || 'Connection failed',
          requestUrl: resolvedUrl,
          timings: { startedAt, durationMs }
        })
      }
    })
  }

  /**
   * Disconnect an active WebSocket connection
   */
  disconnect(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (connection) {
      logger.info('[WebSocketExecutionService] Disconnecting', { requestId })
      connection.ws.close()
      return true
    }
    return false
  }

  /**
   * Send a message on an active connection
   */
  send(requestId: string, message: string, event?: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      const msgToSend = event ? JSON.stringify({ event, data: message }) : message
      connection.ws.send(msgToSend)
      
      const msg: WebSocketMessage = {
        direction: 'sent',
        data: message,
        event,
        timestamp: new Date().toISOString()
      }
      connection.messages.push(msg)
      this.broadcastMessage(requestId, msg)
      return true
    }
    return false
  }

  /**
   * Check if a connection is currently active
   */
  isActive(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    return connection !== undefined && connection.ws.readyState === WebSocket.OPEN
  }

  /**
   * Broadcast progress to renderer
   */
  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('websocket:connection-progress', { requestId, status })
    }
  }

  /**
   * Broadcast message to renderer
   */
  private broadcastMessage(requestId: string, message: WebSocketMessage): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('websocket:message', { requestId, message })
    }
  }
}

/** Singleton instance */
export const websocketExecutionService = new WebSocketExecutionService()
