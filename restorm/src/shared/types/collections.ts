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
  GrpcTransport,
  WebSocketProtocol,
  ODataVersion,
  TrpcCallKind
} from './requestPrimitives'

export type { BaseRequest, HTTPRequest, GraphQLRequest, GrpcRequest, GrpcMockMethod, SoapRequest, WebSocketRequest, SseRequest, ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec, AuthenticationRequest, JsonRpcRequest, JsonRpcBatchRequest, JsonRpcBatchCallSpec, TrpcRequest, Request } from './requests/index'
export type { QuickConfig, QuickConfigStorageTarget } from './requests/index'
export { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isSseRequest, isODataRequest, isAuthenticationRequest, isJsonRpcRequest, isJsonRpcBatchRequest, isTrpcRequest } from './requests/index'

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
  SseFrame,
  SseResponse,
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
  ResponseHistoryTrpcResponse,
  ResponseHistorySseFrame,
  ResponseHistorySseResponse,
  ResponseHistoryResponse,
  ResponseHistoryDetail,
  ResponseHistoryRequestType,
  ResponseHistoryOutcome,
  ResponseHistoryJsonRpcError,
  ResponseHistoryJsonRpcResponse,
  ResponseHistoryJsonRpcBatchChild,
  ResponseHistoryJsonRpcBatchResponse
} from './responseHistory'

export type { Folder, EnvironmentFolder, FolderItem } from './folderTypes'
export type { Scenario, ScenarioNode, ScenarioPort, ScenarioEdge, ScenarioParam, ScenarioNodeKind, ScenarioDataType, ScenarioPortRole, PortFlow } from './scenario'
export { isEnvironmentFolder, isFolder, isAnyFolder, isRequest, isScenario } from './folderTypes'
