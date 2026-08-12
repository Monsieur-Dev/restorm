/**
 * Request models index
 */

export { HTTPRequest, type HTTPRequestBody } from './HTTPRequest'
export { GraphQLRequest } from './GraphQLRequest'
export { GrpcRequest } from './GrpcRequest'
export { SoapRequest } from './SoapRequest'
export { WebSocketRequest } from './WebSocketRequest'
export { SseRequest } from './SseRequest'
export { StompRequest } from './StompRequest'
export { ODataRequest } from './ODataRequest'
export { AuthenticationRequest } from './AuthenticationRequest'
export { JsonRpcRequest } from './JsonRpcRequest'
export { TrpcRequest } from './TrpcRequest'
export { AmqpRequest } from './AmqpRequest'
export { RedisRequest } from './RedisRequest'
export { KafkaRequest } from './KafkaRequest'

// Union type of all request types
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'
import type { SseRequest } from './SseRequest'
import type { StompRequest } from './StompRequest'
import type { ODataRequest } from './ODataRequest'
import type { AuthenticationRequest } from './AuthenticationRequest'
import type { JsonRpcRequest } from './JsonRpcRequest'
import type { JsonRpcBatchRequest } from './JsonRpcRequest'
import type { TrpcRequest } from './TrpcRequest'
import type { AmqpRequest } from './AmqpRequest'
import type { RedisRequest } from './RedisRequest'
import type { KafkaRequest } from './KafkaRequest'

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest | SseRequest | StompRequest | ODataRequest | AuthenticationRequest | JsonRpcRequest | JsonRpcBatchRequest | TrpcRequest | AmqpRequest | RedisRequest | KafkaRequest
