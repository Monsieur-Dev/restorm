/**
 * Request models index
 */

export { BaseRequest } from './BaseRequest'
export { HTTPRequest, type HTTPRequestBody } from './HTTPRequest'
export { GraphQLRequest } from './GraphQLRequest'
export { GrpcRequest } from './GrpcRequest'
export { SoapRequest } from './SoapRequest'
export { WebSocketRequest } from './WebSocketRequest'

// Union type of all request types
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest
