/**
 * Request collections types for Restorm
 * Defines the structure for organizing HTTP requests in folders with environments
 */

export * from './valueTypes'

export type { RuntimeId, Icon, KeyValue, Environment, EnumDefinition, EnumMatchingRule, CustomValueEntry, CustomValueList } from './baseTypes'

export type {
  HTTPMethod,
  HTTPRequestBodyFormData,
  HTTPRequestBodyXWwwFormUrlEncoded,
  GrpcCallType,
  GrpcTransport,
  ODataVersion,
  AmqpMode
} from './requestPrimitives'

export type { HTTPRequest, GraphQLRequest, GrpcRequest, GrpcMockMethod, SoapRequest, WebSocketRequest, SseRequest, StompRequest, StompAckMode, StompSubscription, ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec, AuthenticationRequest, JsonRpcRequest, JsonRpcBatchRequest, JsonRpcBatchCallSpec, TrpcRequest, AmqpRequest, RedisRequest, KafkaRequest, KafkaMode, KafkaFromOffset, KafkaSaslMechanism, Request } from './requests/index'
export { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isSseRequest, isStompRequest, isODataRequest, isAuthenticationRequest, isJsonRpcRequest, isJsonRpcBatchRequest, isTrpcRequest, isAmqpRequest, isRedisRequest, isKafkaRequest } from './requests/index'

export type {
  HTTPResponse,
  GraphQLResponse,
  GrpcResponse,
  SoapResponse,
  WebSocketMessage,
  WebSocketResponse,
  SseFrame,
  SseResponse,
  StompMessage,
  StompResponse
} from './responses/index'

export type {
  ResponseHistoryEntry,
  ResponseHistoryKeyValue,
  ResponseHistoryRequestMeta,
  ResponseHistoryHttpBody,
  ResponseHistoryResponse,
  ResponseHistoryDetail,
  ResponseHistoryRequestType,
  ResponseHistoryOutcome,
  ResponseHistoryJsonRpcBatchChild
} from './responseHistory'

export type { Folder, EnvironmentFolder, FolderItem } from './folderTypes'
export type { Scenario, ScenarioNode, ScenarioPort, ScenarioEdge, ScenarioNodeKind, ScenarioDataType, ScenarioPortRole, PortFlow } from './scenario'
export { isEnvironmentFolder, isFolder, isAnyFolder, isRequest, isScenario } from './folderTypes'
