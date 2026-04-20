import type { BaseRequest } from './BaseRequest'
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'
import type { ODataRequest, ODataQueryOptions, ODataOperationKind } from './ODataRequest'

export type { BaseRequest, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, ODataRequest, ODataQueryOptions, ODataOperationKind }

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest | ODataRequest

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

export function isODataRequest(request: Request): request is ODataRequest {
  return request.type === 'odata'
}
