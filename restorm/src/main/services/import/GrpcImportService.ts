/**
 * Service for importing gRPC proto files into Restorm collections
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  GrpcRequest,
  type GrpcCallType
} from '../../../shared/models'
import type { EnumDefinition } from '../../../shared/types/collections'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { grpcToApiDocumentation } from './transformers/grpcToApiDocumentation'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'

// ============================================================================
// Proto Types
// ============================================================================

interface ProtoField {
  name: string
  type: string
  number: number
  repeated: boolean
}

interface ProtoMessage {
  name: string
  fields: ProtoField[]
}

interface ProtoMethod {
  name: string
  inputType: string
  outputType: string
  clientStreaming: boolean
  serverStreaming: boolean
  comment?: string | undefined
}

interface ProtoService {
  name: string
  methods: ProtoMethod[]
  comment?: string | undefined
}

interface ProtoEnum {
  name: string
  values: string[]
}

interface ParsedProto {
  package: string
  services: ProtoService[]
  messages: ProtoMessage[]
  enums: ProtoEnum[]
}

// ============================================================================
// Parser Functions
// ============================================================================

/** Parse a proto file content */
function parseProto(content: string): ParsedProto {
  const result: ParsedProto = {
    package: '',
    services: [],
    messages: [],
    enums: []
  }
  
  // Extract package
  const packageMatch = /package\s+([\w.]+)\s*;/.exec(content)
  if (packageMatch?.[1]) {
    result.package = packageMatch[1]
  }
  
  // Extract services
  const serviceRegex = /(?:\/\/\s*(.+)\n)?service\s+(\w+)\s*\{([^}]+)\}/g
  let serviceMatch
  
  while ((serviceMatch = serviceRegex.exec(content)) !== null) {
    const serviceComment = serviceMatch[1]?.trim()
    const serviceName = serviceMatch[2]
    const serviceBody = serviceMatch[3]
    
    if (!serviceName || !serviceBody) continue
    
    const methods = parseServiceMethods(serviceBody)
    
    result.services.push({
      name: serviceName,
      methods,
      comment: serviceComment
    })
  }
  
  // Extract messages
  const messageRegex = /message\s+(\w+)\s*\{([^}]+)\}/g
  let messageMatch
  
  while ((messageMatch = messageRegex.exec(content)) !== null) {
    const messageName = messageMatch[1]
    const messageBody = messageMatch[2]
    
    if (!messageName || !messageBody) continue
    
    const fields = parseMessageFields(messageBody)
    
    result.messages.push({
      name: messageName,
      fields
    })
  }

  // Extract proto enums: enum Name { VALUE1 = 0; VALUE2 = 1; }
  const protoEnumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g
  let protoEnumMatch
  while ((protoEnumMatch = protoEnumRegex.exec(content)) !== null) {
    const enumName = protoEnumMatch[1]
    const enumBody = protoEnumMatch[2]
    if (!enumName || !enumBody) continue
    const values = enumBody
      .split('\n')
      .map((l) => l.trim().replace(/\s*=\s*\d+\s*;.*$/, ''))
      .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('option'))
    if (values.length > 0) {
      result.enums.push({ name: enumName, values })
    }
  }

  return result
}

/** Parse methods from a service body */
function parseServiceMethods(body: string): ProtoMethod[] {
  const methods: ProtoMethod[] = []
  const lines = body.split('\n')
  
  let currentComment = ''
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Check for comment
    if (trimmed.startsWith('//')) {
      currentComment = trimmed.slice(2).trim()
      continue
    }
    
    // Parse rpc method
    const rpcMatch = /rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)/.exec(trimmed)
    if (rpcMatch?.[1] && rpcMatch[3] && rpcMatch[5]) {
      methods.push({
        name: rpcMatch[1],
        inputType: rpcMatch[3],
        outputType: rpcMatch[5],
        clientStreaming: !!rpcMatch[2],
        serverStreaming: !!rpcMatch[4],
        comment: currentComment || undefined
      })
      currentComment = ''
    }
  }
  
  return methods
}

/** Parse fields from a message body */
function parseMessageFields(body: string): ProtoField[] {
  const fields: ProtoField[] = []
  const lines = body.split('\n')
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    
    // Parse field: (repeated)? type name = number;
    const fieldMatch = /(repeated\s+)?(\w+)\s+(\w+)\s*=\s*(\d+)/.exec(trimmed)
    if (fieldMatch?.[2] && fieldMatch[3] && fieldMatch[4]) {
      fields.push({
        name: fieldMatch[3],
        type: fieldMatch[2],
        number: parseInt(fieldMatch[4], 10),
        repeated: !!fieldMatch[1]
      })
    }
  }
  
  return fields
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

/** Determine gRPC call type from method definition */
function getCallType(method: ProtoMethod): GrpcCallType {
  if (method.clientStreaming && method.serverStreaming) {
    return 'bidirectional-stream'
  } else if (method.serverStreaming) {
    return 'server-stream'
  } else if (method.clientStreaming) {
    return 'client-stream'
  }
  return 'unary'
}

/** Build a sample request message for a method */
function buildSampleMessage(inputType: string, messages: ProtoMessage[]): string {
  const message = messages.find(m => m.name === inputType)
  if (!message) {
    return '{}'
  }
  
  const sample: Record<string, unknown> = {}
  for (const field of message.fields) {
    sample[field.name] = getSampleValue(field.type, field.repeated)
  }
  
  return JSON.stringify(sample, null, 2)
}

/** Get a sample value for a proto type */
function getSampleValue(type: string, repeated: boolean): unknown {
  let value: unknown
  
  switch (type) {
    case 'string':
      value = ''
      break
    case 'int32':
    case 'int64':
    case 'uint32':
    case 'uint64':
    case 'sint32':
    case 'sint64':
    case 'fixed32':
    case 'fixed64':
    case 'sfixed32':
    case 'sfixed64':
      value = 0
      break
    case 'float':
    case 'double':
      value = 0.0
      break
    case 'bool':
      value = false
      break
    case 'bytes':
      value = ''
      break
    default:
      value = {}
  }
  
  return repeated ? [value] : value
}

/** Convert a proto method to a GrpcRequest */
function methodToRequest(
  service: ProtoService,
  method: ProtoMethod,
  packageName: string,
  messages: ProtoMessage[],
  baseUrl: string,
  collectionName: string
): GrpcRequest {
  const fullServiceName = packageName ? `${packageName}.${service.name}` : service.name
  
  return {
    type: 'grpc',
    id: generateId(`${collectionName}:grpc:${fullServiceName}:${method.name}`),
    name: method.name,
    tags: [getCallType(method)],
    url: baseUrl,
    service: fullServiceName,
    method: method.name,
    callType: getCallType(method),
    requestMessage: buildSampleMessage(method.inputType, messages),
    metadata: []
  }
}

// ============================================================================
// Main Service
// ============================================================================

export interface GrpcImportOptions {
  /** Base URL for gRPC server (host:port) */
  baseUrl?: string
  /** Name for the imported collection */
  name?: string
  /** Original URL the proto was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

/**
 * Import a proto file and convert it to a Folder structure
 */
export function importGrpc(protoContent: string, options: GrpcImportOptions = {}): EnvironmentFolder {
  const baseUrl = options.baseUrl ?? '{{baseUrl}}'
  const parsed = parseProto(protoContent)
  const name = options.name ?? (parsed.package !== '' ? parsed.package : 'gRPC API')
  
  // Create folders for each service
  const items: Folder['items'] = []
  
  for (const service of parsed.services) {
    const serviceFolder: Folder = {
      id: generateId(`${name}:folder:grpc:${service.name}`),
      name: service.name,
      tags: ['service'],
      configuration: {},
      items: service.methods.map(method =>
        methodToRequest(service, method, parsed.package, parsed.messages, baseUrl, name)
      )
    }
    items.push(serviceFolder)
  }

  const environment: Environment = {
    id: generateId(`${name}:env:grpc:Default`),
    name: 'Default',
    variables: [
      createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl ?? 'localhost:9000', enabled: true })
    ]
  }

  const apiDocumentation = grpcToApiDocumentation(parsed, {
    name,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})
  })

  const enumDefinitions: EnumDefinition[] = parsed.enums.map((e) => ({
    id: generateId(`enum:grpc:${e.name}`),
    name: e.name,
    values: e.values,
    matchingRules: []
  }))

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'grpc',
    id: generateId(`${name}:folder:grpc:root`),
    name,
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation,
    ...(enumDefinitions.length > 0 ? { enumDefinitions } : {})
  }

  return rootFolder
}

/**
 * Import a proto file from a string
 */
export function importGrpcFromString(content: string, options: GrpcImportOptions = {}): EnvironmentFolder {
  return importGrpc(content, options)
}
