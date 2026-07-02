import type { BaseRequest, ImportOrigin } from './BaseRequest'
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest, GrpcMockMethod } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'
import type { SseRequest } from './SseRequest'
import type { StompRequest, StompVersion, StompAckMode, StompSubscription } from './StompRequest'
import type { ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec } from './ODataRequest'
import type { AuthenticationRequest } from './AuthenticationRequest'
import type { JsonRpcRequest, JsonRpcBatchRequest, JsonRpcBatchCallSpec } from './JsonRpcRequest'
import type { TrpcRequest } from './TrpcRequest'
import type { AmqpRequest } from './AmqpRequest'
import type { RedisRequest } from './RedisRequest'
import type { KafkaRequest, KafkaMode, KafkaFromOffset, KafkaSaslMechanism } from './KafkaRequest'
import type { QuickConfig, QuickConfigStorageTarget } from './QuickConfig'

export type { BaseRequest, ImportOrigin, HTTPRequest, GraphQLRequest, GrpcRequest, GrpcMockMethod, SoapRequest, WebSocketRequest, SseRequest, StompRequest, StompVersion, StompAckMode, StompSubscription, ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec, AuthenticationRequest, JsonRpcRequest, JsonRpcBatchRequest, JsonRpcBatchCallSpec, TrpcRequest, AmqpRequest, RedisRequest, KafkaRequest, KafkaMode, KafkaFromOffset, KafkaSaslMechanism }
export type { QuickConfig, QuickConfigStorageTarget }

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest | SseRequest | StompRequest | ODataRequest | AuthenticationRequest | JsonRpcRequest | JsonRpcBatchRequest | TrpcRequest | AmqpRequest | RedisRequest | KafkaRequest

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

export function isSseRequest(request: Request): request is SseRequest {
  return request.type === 'sse'
}

export function isStompRequest(request: Request): request is StompRequest {
  return request.type === 'stomp'
}

export function isODataRequest(request: Request): request is ODataRequest {
  return request.type === 'odata'
}

export function isAuthenticationRequest(request: Request): request is AuthenticationRequest {
  return request.type === 'auth'
}

export function isJsonRpcRequest(request: Request): request is JsonRpcRequest {
  return request.type === 'jsonrpc'
}

export function isJsonRpcBatchRequest(request: Request): request is JsonRpcBatchRequest {
  return request.type === 'jsonrpcBatch'
}

export function isTrpcRequest(request: Request): request is TrpcRequest {
  return request.type === 'trpc'
}

export function isAmqpRequest(request: Request): request is AmqpRequest {
  return request.type === 'amqp'
}

export function isRedisRequest(request: Request): request is RedisRequest {
  return request.type === 'redis'
}

export function isKafkaRequest(request: Request): request is KafkaRequest {
  return request.type === 'kafka'
}
