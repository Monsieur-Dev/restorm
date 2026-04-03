/**
 * gRPC Request Service
 * Handles executing gRPC requests via grpc-web
 * 
 * Note: Full gRPC support requires a gRPC-Web proxy or native gRPC.
 * This implementation uses HTTP/2 fetch for basic unary calls.
 */

import type { GrpcRequest, GrpcResponse, KeyValue } from '../../../shared/types/collections'
import { StringValue } from '../../../shared/types/collections'
import { logger } from 'electron-core-ui/main'
import type { VariableContext } from './types'
import { resolveTemplate } from './resolveTemplate'

/** Input for executing a gRPC request */
export interface GrpcRequestInput {
  /** The gRPC request definition */
  request: GrpcRequest
  /** Current URL (host:port) */
  url: string
  /** Current service name */
  service: string
  /** Current method name */
  method: string
  /** Current request message (JSON) */
  requestMessage: string
  /** Current metadata */
  metadata: KeyValue[]
  /** Variable context from environments */
  variableContext: VariableContext
}

/** Generate a unique ID for the response */
function generateResponseId(): string {
  return `resp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/** Resolve KeyValue pairs with variable context */
function resolveKeyValues(keyValues: KeyValue[], context: VariableContext): KeyValue[] {
  return keyValues.map((kv) => ({
    ...kv,
    key: resolveTemplate(kv.key, context),
    value: new StringValue(resolveTemplate(kv.value.toString(), context))
  }))
}

/**
 * Execute a gRPC request
 * 
 * Note: This is a placeholder implementation. Full gRPC support would require:
 * - gRPC-Web proxy (like Envoy) for browser compatibility
 * - Or native gRPC via Electron's Node.js APIs
 */
export function executeGrpcRequest(input: GrpcRequestInput): Promise<GrpcResponse> {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()
  
  const context = input.variableContext
  
  // Resolve URL and service/method
  const resolvedUrl = resolveTemplate(input.url, context)
  const resolvedService = resolveTemplate(input.service, context)
  const resolvedMethod = resolveTemplate(input.method, context)
  const resolvedMessage = resolveTemplate(input.requestMessage, context)
  
  // Resolve metadata
  const resolvedMetadata = resolveKeyValues(input.metadata, context)
  
  const fullMethod = `${resolvedService}/${resolvedMethod}`
  
  // For now, return a placeholder response indicating gRPC is not fully implemented
  // In a real implementation, you would use @grpc/grpc-js or grpc-web here
  const durationMs = Date.now() - startTime
  
  // Parse message safely
  let parsedMessage: unknown = {}
  try {
    parsedMessage = JSON.parse(resolvedMessage) as unknown
  } catch (error) {
    logger.warn('[GrpcRequestService] Failed to parse JSON metadata', { error: String(error) })
  }
  
  return Promise.resolve({
    id: generateResponseId(),
    type: 'grpc',
    requestId: input.request.id,
    requestUrl: resolvedUrl,
    requestMethod: fullMethod,
    requestMessage: resolvedMessage,
    requestMetadata: resolvedMetadata,
    statusCode: 12, // UNIMPLEMENTED
    statusMessage: 'gRPC calls require a gRPC-Web proxy or native implementation',
    responseMessage: JSON.stringify({
      note: 'gRPC support requires additional setup',
      url: resolvedUrl,
      service: resolvedService,
      method: resolvedMethod,
      message: parsedMessage
    }, null, 2),
    responseMetadata: [],
    error: 'gRPC not fully implemented - requires gRPC-Web proxy',
    timings: {
      startedAt,
      durationMs
    }
  })
}
