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
  TrpcCallKind,
  AmqpMode,
  RedisMode,
  RedisCommandName
} from './requestPrimitives'

export type { BaseRequest, HTTPRequest, GraphQLRequest, GrpcRequest, GrpcMockMethod, SoapRequest, WebSocketRequest, SseRequest, StompRequest, StompVersion, StompAckMode, StompSubscription, ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec, AuthenticationRequest, JsonRpcRequest, JsonRpcBatchRequest, JsonRpcBatchCallSpec, TrpcRequest, AmqpRequest, RedisRequest, KafkaRequest, KafkaMode, KafkaFromOffset, KafkaSaslMechanism, Request } from './requests/index'
export type { QuickConfig, QuickConfigStorageTarget } from './requests/index'
export { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isSseRequest, isStompRequest, isODataRequest, isAuthenticationRequest, isJsonRpcRequest, isJsonRpcBatchRequest, isTrpcRequest, isAmqpRequest, isRedisRequest, isKafkaRequest } from './requests/index'

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
  StompMessage,
  StompResponse,
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
  ResponseHistoryAmqpMessage,
  ResponseHistoryAmqpResponse,
  ResponseHistoryRedisMessage,
  ResponseHistoryRedisResponse,
  ResponseHistoryStompMessage,
  ResponseHistoryStompResponse,
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
