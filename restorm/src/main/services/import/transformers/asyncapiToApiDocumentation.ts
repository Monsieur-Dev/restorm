/**
 * AsyncAPI → ApiDocumentation transformer.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ParameterDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- AsyncAPI source-spec types ----------

interface AsyncAPIServerData {
  url: string
  protocol: string
  description?: string
}

interface AsyncAPIMessagePayloadData {
  type?: string
  properties?: Record<string, { type?: string; description?: string }>
  $ref?: string
}

interface AsyncAPIMessageData {
  name?: string
  title?: string
  summary?: string
  description?: string
  payload?: AsyncAPIMessagePayloadData
}

interface AsyncAPIOperationData {
  operationId?: string
  summary?: string
  description?: string
  message?: AsyncAPIMessageData | { $ref: string }
}

interface AsyncAPIChannelData {
  description?: string
  servers?: string[]
  publish?: AsyncAPIOperationData
  subscribe?: AsyncAPIOperationData
  parameters?: Record<string, { description?: string; schema?: { type: string } }>
}

export interface AsyncAPISpecData {
  asyncapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  servers?: Record<string, AsyncAPIServerData>
  channels: Record<string, AsyncAPIChannelData>
  components?: {
    messages?: Record<string, AsyncAPIMessageData>
    schemas?: Record<string, unknown>
  }
}

export interface AsyncAPITransformOptions {
  sourceUrl?: string
}

// ---------- Helpers ----------

function protocolGroupLabel(protocol: string): string {
  const lower = protocol.toLowerCase()
  if (lower === 'mqtt' || lower === 'mqtts') return 'MQTT'
  if (lower === 'socketio' || lower === 'socket.io') return 'Socket.IO'
  return 'WebSocket'
}

function resolveMessage(
  message: AsyncAPIOperationData['message'],
  spec: AsyncAPISpecData
): AsyncAPIMessageData | undefined {
  if (!message) return undefined
  if ('$ref' in message && typeof message.$ref === 'string') {
    const ref = message.$ref
    const prefix = '#/components/messages/'
    if (ref.startsWith(prefix)) {
      const name = ref.slice(prefix.length)
      return spec.components?.messages?.[name]
    }
    return undefined
  }
  return message as AsyncAPIMessageData
}

function extractParameters(msg: AsyncAPIMessageData | undefined): ParameterDocumentation[] | undefined {
  const props = msg?.payload?.properties
  if (!props) return undefined
  const params: ParameterDocumentation[] = []
  for (const [name, def] of Object.entries(props)) {
    const entry: ParameterDocumentation = {
      name,
      location: 'body',
      type: def.type ?? 'any',
      required: false
    }
    if (def.description !== undefined) entry.description = def.description
    params.push(entry)
  }
  return params.length > 0 ? params : undefined
}

function extractReferencedModels(msg: AsyncAPIMessageData | undefined): string[] | undefined {
  const ref = msg?.payload?.$ref
  if (!ref) return undefined
  const prefix = '#/components/schemas/'
  if (ref.startsWith(prefix)) return [ref.slice(prefix.length)]
  return undefined
}

function mapSchemasToModels(
  schemas: Record<string, unknown> | undefined
): Record<string, ModelDocumentation> {
  if (!schemas) return {}
  const out: Record<string, ModelDocumentation> = {}
  for (const [name, raw] of Object.entries(schemas)) {
    if (raw == null || typeof raw !== 'object') continue
    const schema = raw as {
      description?: string
      properties?: Record<string, { type?: string; description?: string }>
      required?: string[]
    }
    const required = new Set(schema.required ?? [])
    const model: ModelDocumentation = {
      name,
      properties: Object.entries(schema.properties ?? {}).map(([propName, propSchema]) => {
        const prop: typeof model.properties[number] = {
          name: propName,
          type: propSchema.type ?? 'any',
          required: required.has(propName)
        }
        if (propSchema.description !== undefined) prop.description = propSchema.description
        return prop
      })
    }
    if (schema.description !== undefined) model.description = schema.description
    out[name] = model
  }
  return out
}

// ---------- Entry point ----------

export function asyncapiToApiDocumentation(
  spec: AsyncAPISpecData,
  options: AsyncAPITransformOptions = {}
): ApiDocumentation {
  const servers = spec.servers ?? {}
  const serverEntries = Object.values(servers)
  const firstServer = serverEntries[0]

  const groups: Record<string, GroupDocumentation> = {}
  const operations: OperationDocumentation[] = []

  const resolveChannelProtocol = (channel: AsyncAPIChannelData): string => {
    const serverName = channel.servers?.[0]
    if (serverName && servers[serverName]) return servers[serverName].protocol
    return firstServer?.protocol ?? 'websocket'
  }

  for (const [channelPath, channel] of Object.entries(spec.channels)) {
    const groupLabel = protocolGroupLabel(resolveChannelProtocol(channel))
    groups[groupLabel] ??= { name: groupLabel }

    const serverName = channel.servers?.[0]
    const serverUrl = (serverName && servers[serverName]?.url) ?? firstServer?.url ?? ''

    const buildOp = (
      direction: 'publish' | 'subscribe',
      op: AsyncAPIOperationData | undefined
    ): void => {
      if (!op) return
      const msg = resolveMessage(op.message, spec)
      const doc: OperationDocumentation = {
        match: {
          urlPattern: serverUrl,
          event: channelPath,
          direction
        },
        group: groupLabel
      }
      const summary = op.operationId ?? channelPath
      doc.summary = summary
      if (op.operationId !== undefined) doc.operationId = op.operationId
      const description = op.description ?? op.summary ?? channel.description
      if (description !== undefined) doc.description = description
      const params = extractParameters(msg)
      if (params !== undefined) doc.parameters = params
      const refs = extractReferencedModels(msg)
      if (refs !== undefined) doc.referencedModels = refs
      operations.push(doc)
    }

    buildOp('publish', channel.publish)
    buildOp('subscribe', channel.subscribe)
  }

  const result: ApiDocumentation = {
    sourceType: 'asyncapi',
    api: {
      title: spec.info.title,
      version: spec.info.version
    },
    models: mapSchemasToModels(spec.components?.schemas),
    groups,
    operations
  }

  if (spec.info.description !== undefined) result.api.description = spec.info.description
  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl
  if (firstServer?.url) result.server = { host: firstServer.url }

  return result
}
