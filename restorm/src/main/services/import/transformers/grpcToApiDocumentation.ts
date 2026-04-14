/**
 * gRPC Proto → ApiDocumentation transformer.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  PropertyDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- Proto source-spec types (mirror GrpcImportService) ----------

export interface ProtoFieldData {
  name: string
  type: string
  number: number
  repeated: boolean
}

export interface ProtoMessageData {
  name: string
  fields: ProtoFieldData[]
}

export interface ProtoMethodData {
  name: string
  inputType: string
  outputType: string
  clientStreaming: boolean
  serverStreaming: boolean
  comment?: string | undefined
}

export interface ProtoServiceData {
  name: string
  methods: ProtoMethodData[]
  comment?: string | undefined
}

export interface ParsedProtoData {
  package: string
  services: ProtoServiceData[]
  messages: ProtoMessageData[]
}

export interface GrpcTransformOptions {
  /** Fallback API title when the proto has no package declaration. */
  name?: string
  /** Host / baseUrl the generated routes are pinned to. */
  baseUrl?: string
  /** Original URL the proto was fetched from. */
  sourceUrl?: string
}

// ---------- Helpers ----------

type CallType = 'unary' | 'server-stream' | 'client-stream' | 'bidirectional-stream'

function callTypeOf(method: ProtoMethodData): CallType {
  if (method.clientStreaming && method.serverStreaming) return 'bidirectional-stream'
  if (method.clientStreaming) return 'client-stream'
  if (method.serverStreaming) return 'server-stream'
  return 'unary'
}

function mapMessagesToModels(messages: ProtoMessageData[]): Record<string, ModelDocumentation> {
  const out: Record<string, ModelDocumentation> = {}
  for (const msg of messages) {
    const properties: PropertyDocumentation[] = msg.fields.map((f) => ({
      name: f.name,
      type: f.repeated ? `repeated ${f.type}` : f.type,
      required: false
    }))
    out[msg.name] = { name: msg.name, properties }
  }
  return out
}

// ---------- Entry point ----------

export function grpcToApiDocumentation(
  parsed: ParsedProtoData,
  options: GrpcTransformOptions = {}
): ApiDocumentation {
  const title = parsed.package !== '' ? parsed.package : options.name ?? 'gRPC API'
  const baseUrl = options.baseUrl ?? ''

  const groups: Record<string, GroupDocumentation> = {}
  const operations: OperationDocumentation[] = []

  for (const service of parsed.services) {
    const group: GroupDocumentation = { name: service.name }
    if (service.comment !== undefined) group.description = service.comment
    groups[service.name] = group

    const qualifiedName = parsed.package !== '' ? `${parsed.package}.${service.name}` : service.name

    for (const method of service.methods) {
      const doc: OperationDocumentation = {
        match: {
          urlPattern: baseUrl,
          operationName: method.name,
          serviceName: qualifiedName
        },
        group: service.name,
        summary: method.name,
        operationId: method.name,
        extra: { callType: callTypeOf(method) }
      }
      if (method.comment !== undefined) doc.description = method.comment
      const refs = Array.from(new Set([method.inputType, method.outputType]))
      if (refs.length > 0) doc.referencedModels = refs
      operations.push(doc)
    }
  }

  const result: ApiDocumentation = {
    sourceType: 'grpc',
    api: {
      title,
      description: 'gRPC API'
    },
    models: mapMessagesToModels(parsed.messages),
    groups,
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl
  if (options.baseUrl !== undefined) {
    result.server = { host: options.baseUrl }
  }

  return result
}
