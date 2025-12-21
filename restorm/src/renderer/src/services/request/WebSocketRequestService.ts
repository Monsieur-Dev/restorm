/**
 * WebSocket/Socket.IO/MQTT Request Service
 * Handles real-time messaging connections
 */

import type { WebSocketRequest, WebSocketResponse, WebSocketMessage, KeyValue } from '../../types/collections'
import { resolveTemplate, type VariableContext } from '../VariableResolutionService'

/** Input for executing a WebSocket request */
export interface WebSocketRequestInput {
  /** The WebSocket request definition */
  request: WebSocketRequest
  /** Current URL */
  url: string
  /** Protocol type */
  protocol: 'websocket' | 'socketio' | 'mqtt'
  /** Event/channel name */
  event?: string | undefined
  /** Message to send */
  message: string
  /** Headers/options */
  headers: KeyValue[]
  /** Variable context from environments */
  variableContext: VariableContext
}

/** WebSocket connection state */
export interface WebSocketConnection {
  /** Unique connection ID */
  id: string
  /** Connection URL */
  url: string
  /** Protocol */
  protocol: 'websocket' | 'socketio' | 'mqtt'
  /** Connection status */
  connected: boolean
  /** Native WebSocket instance */
  socket?: WebSocket | undefined
  /** Message history */
  messages: WebSocketMessage[]
  /** Connection timestamp */
  connectedAt?: string | undefined
  /** Disconnect callback */
  onDisconnect?: (() => void) | undefined
  /** Message callback */
  onMessage?: ((msg: WebSocketMessage) => void) | undefined
}

// Store active connections
const connections = new Map<string, WebSocketConnection>()

/** Generate a unique ID */
function generateId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/** Generate a response ID */
function generateResponseId(): string {
  return `resp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Connect to a WebSocket server
 */
export function connectWebSocket(
  input: WebSocketRequestInput,
  onMessage?: (msg: WebSocketMessage) => void,
  onDisconnect?: () => void
): WebSocketConnection {
  const context = input.variableContext
  const resolvedUrl = resolveTemplate(input.url, context)
  
  const connectionId = generateId()
  
  const connection: WebSocketConnection = {
    id: connectionId,
    url: resolvedUrl,
    protocol: input.protocol,
    connected: false,
    messages: [],
    onMessage,
    onDisconnect
  }
  
  // For browser WebSocket
  if (input.protocol === 'websocket') {
    try {
      const socket = new WebSocket(resolvedUrl)
      connection.socket = socket
      
      socket.onopen = () => {
        connection.connected = true
        connection.connectedAt = new Date().toISOString()
      }
      
      socket.onmessage = (event) => {
        const msg: WebSocketMessage = {
          direction: 'received',
          data: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
          timestamp: new Date().toISOString()
        }
        connection.messages.push(msg)
        onMessage?.(msg)
      }
      
      socket.onclose = () => {
        connection.connected = false
        onDisconnect?.()
      }
      
      socket.onerror = () => {
        connection.connected = false
      }
    } catch {
      connection.connected = false
    }
  }
  
  // Socket.IO and MQTT would require additional libraries
  // For now, we'll note that they need specific client implementations
  if (input.protocol === 'socketio' || input.protocol === 'mqtt') {
    // These protocols require specific client libraries:
    // - Socket.IO: socket.io-client
    // - MQTT: mqtt.js
    // In Electron, these can be loaded via the main process or preload
  }
  
  connections.set(connectionId, connection)
  return connection
}

/**
 * Send a message through an existing connection
 */
export function sendWebSocketMessage(
  connectionId: string,
  message: string,
  event?: string
): WebSocketMessage | null {
  const connection = connections.get(connectionId)
  if (!connection?.connected) {
    return null
  }
  
  const msg: WebSocketMessage = {
    direction: 'sent',
    event,
    data: message,
    timestamp: new Date().toISOString()
  }
  
  if (connection.protocol === 'websocket' && connection.socket) {
    connection.socket.send(message)
    connection.messages.push(msg)
    return msg
  }
  
  return null
}

/**
 * Disconnect from a WebSocket server
 */
export function disconnectWebSocket(connectionId: string): void {
  const connection = connections.get(connectionId)
  if (!connection) return
  
  if (connection.socket) {
    connection.socket.close()
  }
  
  connection.connected = false
  connections.delete(connectionId)
}

/**
 * Get all active connections
 */
export function getActiveConnections(): WebSocketConnection[] {
  return Array.from(connections.values())
}

/**
 * Execute a WebSocket request (connect, send, wait for response)
 * This is a simplified one-shot pattern for testing
 */
export async function executeWebSocketRequest(
  input: WebSocketRequestInput,
  timeoutMs = 5000
): Promise<WebSocketResponse> {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()
  
  const context = input.variableContext
  const resolvedUrl = resolveTemplate(input.url, context)
  const resolvedMessage = resolveTemplate(input.message, context)
  const resolvedEvent = input.event ? resolveTemplate(input.event, context) : undefined
  
  return new Promise((resolve) => {
    const messages: WebSocketMessage[] = []
    let connected = false
    
    const connection = connectWebSocket(
      input,
      (msg) => {
        messages.push(msg)
      },
      () => {
        // On disconnect
      }
    )
    
    // Wait for connection
    const checkConnection = setInterval(() => {
      if (connection.connected && !connected) {
        connected = true
        
        // Send message
        const sentMsg = sendWebSocketMessage(connection.id, resolvedMessage, resolvedEvent)
        if (sentMsg) {
          messages.push(sentMsg)
        }
      }
    }, 100)
    
    // Timeout
    setTimeout(() => {
      clearInterval(checkConnection)
      disconnectWebSocket(connection.id)
      
      const durationMs = Date.now() - startTime
      
      resolve({
        id: generateResponseId(),
        type: 'websocket',
        requestId: input.request.id,
        requestUrl: resolvedUrl,
        protocol: input.protocol,
        connected,
        messages,
        timings: {
          startedAt,
          durationMs
        },
        error: connected ? undefined : 'Connection failed or timed out'
      })
    }, timeoutMs)
  })
}
