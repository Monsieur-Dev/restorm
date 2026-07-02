/**
 * Request models index
 */

export { BaseRequest } from './BaseRequest'
export { HTTPRequest, type HTTPRequestBody } from './HTTPRequest'
export { GraphQLRequest } from './GraphQLRequest'
export { GrpcRequest } from './GrpcRequest'
export { SoapRequest } from './SoapRequest'
export { WebSocketRequest } from './WebSocketRequest'
export { ODataRequest, type ODataQueryOptions, type ODataOperationKind } from './ODataRequest'
export { AuthenticationRequest } from './AuthenticationRequest'
export { JsonRpcRequest, JsonRpcBatchRequest, type JsonRpcBatchCallSpec } from './JsonRpcRequest'

// Union type of all request types
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'
import type { ODataRequest } from './ODataRequest'
import type { AuthenticationRequest } from './AuthenticationRequest'
import type { JsonRpcRequest } from './JsonRpcRequest'
import type { JsonRpcBatchRequest } from './JsonRpcRequest'

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest | ODataRequest | AuthenticationRequest | JsonRpcRequest | JsonRpcBatchRequest
