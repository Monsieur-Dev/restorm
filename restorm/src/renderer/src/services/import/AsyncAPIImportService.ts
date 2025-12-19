/**
 * Service for importing AsyncAPI specifications into Restorm collections
 * Supports MQTT, Socket.IO, and WebSocket channels
 */

import type {
  Folder,
  EnvironmentFolder,
  Environment,
  WebSocketRequest,
  WebSocketProtocol
} from '../../types/collections'
import * as yaml from 'yaml'

// ============================================================================
// AsyncAPI Types
// ============================================================================

interface AsyncAPIServer {
  url: string
  protocol: string
  description?: string
}

interface AsyncAPIMessagePayload {
  type?: string
  properties?: Record<string, { type?: string; description?: string }>
}

interface AsyncAPIMessage {
  name?: string
  title?: string
  summary?: string
  description?: string
  payload?: AsyncAPIMessagePayload
}

interface AsyncAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  message?: AsyncAPIMessage | { $ref: string }
}

interface AsyncAPIChannel {
  description?: string
  servers?: string[]
  publish?: AsyncAPIOperation
  subscribe?: AsyncAPIOperation
  parameters?: Record<string, { description?: string; schema?: { type: string } }>
}

interface AsyncAPISpec {
  asyncapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  servers?: Record<string, AsyncAPIServer>
  channels: Record<string, AsyncAPIChannel>
  components?: {
    messages?: Record<string, AsyncAPIMessage>
    schemas?: Record<string, unknown>
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Generate a deterministic ID from a seed string */
function generateId(seed?: string): string {
  if (!seed) {
    return crypto.randomUUID()
  }
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-${seed.length.toString(16).padStart(4, '0')}-4000-8000-${hex}${hex.slice(0, 4)}`
}

/** Map AsyncAPI protocol to WebSocketProtocol */
function mapProtocol(protocol: string): WebSocketProtocol {
  const lower = protocol.toLowerCase()
  if (lower === 'mqtt' || lower === 'mqtts') return 'mqtt'
  if (lower === 'socketio' || lower === 'socket.io') return 'socketio'
  return 'websocket'
}

/** Build a sample message payload from schema */
function buildSamplePayload(payload?: AsyncAPIMessagePayload): string {
  if (!payload) return '{}'
  
  if (payload.properties) {
    const sample: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(payload.properties)) {
      switch (prop.type) {
        case 'string':
          sample[key] = ''
          break
        case 'integer':
        case 'number':
          sample[key] = 0
          break
        case 'boolean':
          sample[key] = false
          break
        case 'array':
          sample[key] = []
          break
        case 'object':
          sample[key] = {}
          break
        default:
          sample[key] = null
      }
    }
    return JSON.stringify(sample, null, 2)
  }
  
  return '{}'
}

/** Resolve message reference */
function resolveMessage(
  msg: AsyncAPIMessage | { $ref: string } | undefined,
  spec: AsyncAPISpec
): AsyncAPIMessage | undefined {
  if (!msg) return undefined
  
  if ('$ref' in msg) {
    const refPath = msg.$ref.replace('#/components/messages/', '')
    return spec.components?.messages?.[refPath]
  }
  
  return msg
}

/** Convert an AsyncAPI channel to WebSocketRequests */
function channelToRequests(
  channelPath: string,
  channel: AsyncAPIChannel,
  spec: AsyncAPISpec,
  servers: Record<string, AsyncAPIServer>,
  collectionName: string
): WebSocketRequest[] {
  const requests: WebSocketRequest[] = []
  
  // Determine server and protocol
  const serverNames = channel.servers ?? Object.keys(servers)
  const serverName = serverNames[0]
  const server = serverName ? servers[serverName] : undefined
  const protocol = mapProtocol(server?.protocol ?? 'websocket')
  
  // Build base URL
  let baseUrl = '{{baseUrl}}'
  if (server?.url) {
    const protocolPrefix = protocol === 'mqtt' ? 'mqtt://' : 'ws://'
    baseUrl = server.url.includes('://') ? server.url : `${protocolPrefix}${server.url}`
  }
  
  // Create request for publish operation
  if (channel.publish) {
    const op = channel.publish
    const message = resolveMessage(op.message, spec)
    
    requests.push({
      type: 'websocket',
      id: generateId(`${collectionName}:ws:publish:${channelPath}`),
      name: op.operationId ?? `Publish to ${channelPath}`,
      documentation: op.description ?? op.summary ?? `Publish to channel: ${channelPath}`,
      tags: ['publish', protocol],
      url: baseUrl,
      protocol,
      event: channelPath,
      message: buildSamplePayload(message?.payload),
      headers: []
    })
  }
  
  // Create request for subscribe operation
  if (channel.subscribe) {
    const op = channel.subscribe
    const message = resolveMessage(op.message, spec)
    
    requests.push({
      type: 'websocket',
      id: generateId(`${collectionName}:ws:subscribe:${channelPath}`),
      name: op.operationId ?? `Subscribe to ${channelPath}`,
      documentation: op.description ?? op.summary ?? `Subscribe to channel: ${channelPath}`,
      tags: ['subscribe', protocol],
      url: baseUrl,
      protocol,
      event: channelPath,
      message: buildSamplePayload(message?.payload),
      headers: []
    })
  }
  
  // If no operations defined, create a generic request
  if (!channel.publish && !channel.subscribe) {
    requests.push({
      type: 'websocket',
      id: generateId(`${collectionName}:ws:channel:${channelPath}`),
      name: channelPath,
      documentation: channel.description ?? `Channel: ${channelPath}`,
      tags: [protocol],
      url: baseUrl,
      protocol,
      event: channelPath,
      message: '{}',
      headers: []
    })
  }
  
  return requests
}

// ============================================================================
// Main Service
// ============================================================================

export interface AsyncAPIImportOptions {
  /** Override base URL */
  baseUrl?: string
  /** Name for the imported collection */
  name?: string
}

/**
 * Import an AsyncAPI specification and convert it to a Folder structure
 */
export function importAsyncAPI(specContent: string, options: AsyncAPIImportOptions = {}): EnvironmentFolder {
  // Parse YAML or JSON
  let spec: AsyncAPISpec
  try {
    spec = yaml.parse(specContent) as AsyncAPISpec
  } catch {
    spec = JSON.parse(specContent) as AsyncAPISpec
  }
  
  const name = options.name ?? spec.info.title
  const servers = spec.servers ?? {}
  
  // Group channels by protocol
  const mqttRequests: WebSocketRequest[] = []
  const socketioRequests: WebSocketRequest[] = []
  const websocketRequests: WebSocketRequest[] = []
  
  for (const [channelPath, channel] of Object.entries(spec.channels)) {
    const requests = channelToRequests(channelPath, channel, spec, servers, name)
    for (const req of requests) {
      if (req.protocol === 'mqtt') {
        mqttRequests.push(req)
      } else if (req.protocol === 'socketio') {
        socketioRequests.push(req)
      } else {
        websocketRequests.push(req)
      }
    }
  }
  
  // Create folders for each protocol with requests
  const items: Folder['items'] = []
  
  if (mqttRequests.length > 0) {
    items.push({
      id: generateId(`${name}:folder:asyncapi:mqtt`),
      name: 'MQTT',
      documentation: '# MQTT Channels\n\nMessage broker pub/sub',
      tags: ['mqtt'],
      configuration: {},
      items: mqttRequests
    })
  }
  
  if (socketioRequests.length > 0) {
    items.push({
      id: generateId(`${name}:folder:asyncapi:socketio`),
      name: 'Socket.IO',
      documentation: '# Socket.IO Events\n\nReal-time bidirectional communication',
      tags: ['socketio'],
      configuration: {},
      items: socketioRequests
    })
  }
  
  if (websocketRequests.length > 0) {
    items.push({
      id: generateId(`${name}:folder:asyncapi:websocket`),
      name: 'WebSocket',
      documentation: '# WebSocket Channels\n\nRaw WebSocket connections',
      tags: ['websocket'],
      configuration: {},
      items: websocketRequests
    })
  }
  
  // Build environment variables from servers
  const envVariables: { key: string; value: string }[] = []
  const serverEntries = Object.entries(servers)
  const firstEntry = serverEntries[0]
  
  if (firstEntry) {
    const [, firstServer] = firstEntry
    envVariables.push({
      key: 'baseUrl',
      value: options.baseUrl ?? firstServer.url
    })
  } else {
    envVariables.push({
      key: 'baseUrl',
      value: options.baseUrl ?? 'localhost:3001'
    })
  }
  
  const environment: Environment = {
    id: generateId(`${name}:env:asyncapi:Default`),
    name: 'Default',
    variables: envVariables
  }
  
  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    id: generateId(`${name}:folder:asyncapi:root`),
    name,
    documentation: `# ${name}\n\n${spec.info.description ?? 'AsyncAPI Specification'}\n\nVersion: ${spec.info.version}`,
    tags: [],
    configuration: {},
    environments: [environment],
    items
  }
  
  return rootFolder
}

/**
 * Import an AsyncAPI spec from a string (YAML or JSON)
 */
export function importAsyncAPIFromString(content: string, options: AsyncAPIImportOptions = {}): EnvironmentFolder {
  return importAsyncAPI(content, options)
}
