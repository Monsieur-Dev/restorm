/**
 * Request collections types for Restorm
 * Defines the structure for organizing HTTP requests in folders with environments
 */

export * from './valueTypes'

export type { RuntimeId, IconType, Icon, KeyValue, Environment, FolderConfiguration, EnumDefinition, EnumMatchingRule, CustomValueEntry, CustomValueList, ImportSourceType } from './baseTypes'

export type {
  HTTPMethod,
  HTTPRequestBody,
  HTTPRequestBodyText,
  HTTPRequestBodyFile,
  HTTPRequestBodyFormData,
  HTTPRequestBodyXWwwFormUrlEncoded,
  GraphQLOperationType,
  GrpcCallType,
  WebSocketProtocol,
  ODataVersion
} from './requestPrimitives'

export type { BaseRequest, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchSubRequestSpec, ODataOperationParameterSpec, AuthenticationRequest, Request } from './requests/index'
export { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isODataRequest, isAuthenticationRequest } from './requests/index'

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
  ResponseHistoryRequestType,
  ResponseHistoryOutcome
} from './responseHistory'

export type { Folder, EnvironmentFolder, FolderItem } from './folderTypes'
export type { Scenario, ScenarioNode, ScenarioPort, ScenarioEdge, ScenarioParam, ScenarioNodeKind, ScenarioDataType, ScenarioPortRole } from './scenario'
export { isEnvironmentFolder, isFolder, isAnyFolder, isRequest, isScenario } from './folderTypes'
