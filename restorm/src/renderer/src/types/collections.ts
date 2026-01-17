/**
 * Request collections types for Restorm
 * Defines the structure for organizing HTTP requests in folders with environments
 */

export * from './valueTypes'

export type { RuntimeId } from './baseTypes'
export type { IconType, Icon, KeyValue, Environment, FolderConfiguration } from './baseTypes'

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

export type { BaseRequest, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, Request } from './requests/index.ts'
export { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest } from './requests/index.ts'

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
} from './responses/index.ts'

export type {
  ResponseHistoryEntry,
  ResponseHistoryIndex,
  ResponseHistoryKeyValue,
  ResponseHistoryRequestMeta,
  ResponseHistoryHttpBody,
  ResponseHistoryHttpResponse,
  ResponseHistoryGraphQLResponse,
  ResponseHistoryGrpcResponse,
  ResponseHistorySoapResponse,
  ResponseHistoryWebSocketMessage,
  ResponseHistoryWebSocketResponse,
  ResponseHistoryResponse,
  ResponseHistoryDetail,
  ResponseHistoryRequestType
} from '../../../shared/types/responseHistory'

export type { Folder, EnvironmentFolder, FolderItem } from './folderTypes'
export { isEnvironmentFolder, isFolder, isAnyFolder, isRequest } from './folderTypes'
