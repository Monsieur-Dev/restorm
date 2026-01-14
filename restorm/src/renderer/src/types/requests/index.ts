import type { BaseRequest } from './BaseRequest'
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'

export type { BaseRequest, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest }

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest

export function isHTTPRequest(request: Request): request is HTTPRequest {
  return request.type === 'http'
}

export function isGraphQLRequest(request: Request): request is GraphQLRequest {
  return request.type === 'graphql'
}

export function isGrpcRequest(request: Request): request is GrpcRequest {
  return request.type === 'grpc'
}

export function isSoapRequest(request: Request): request is SoapRequest {
  return request.type === 'soap'
}

export function isWebSocketRequest(request: Request): request is WebSocketRequest {
  return request.type === 'websocket'
}
