/**
 * Request collections types for Restorm
 * Defines the structure for organizing HTTP requests in folders with environments
 */

export * from './valueTypes'

export type { RuntimeId, IconType, Icon, KeyValue, Environment, FolderConfiguration } from './baseTypes'

export type {
  HTTPMethod,
  HTTPRequestBody,
  HTTPRequestBodyText,
  HTTPRequestBodyFile,
  HTTPRequestBodyFormData,
  HTTPRequestBodyXWwwFormUrlEncoded,
  GraphQLOperationType,
  GrpcCallType,
  WebSocketProtocol
} from './requestPrimitives'

export type { BaseRequest, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, Request } from './requests/index'
export { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest } from './requests/index'

export type {
  BaseResponse,
  HTTPTimings,
  HTTPNetworkInfo,
  HTTPResponse,
  GraphQLResponse,
  GrpcResponse,
  SoapResponse,
  WebSocketMessage,
  WebSocketResponse,
  Response
} from './responses/index'

export type { Folder, EnvironmentFolder, FolderItem } from './folderTypes'
export { isEnvironmentFolder, isFolder, isAnyFolder, isRequest } from './folderTypes'
