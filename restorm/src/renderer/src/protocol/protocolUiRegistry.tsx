import { cloneElement, isValidElement, type ReactNode } from 'react'
import type { RequestType } from '../../../shared/protocolRegistry'
import type {
  Request,
  HTTPRequest,
  AuthenticationRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest,
  SseRequest,
  ODataRequest,
  JsonRpcRequest,
  JsonRpcBatchRequest,
  TrpcRequest,
  AmqpRequest,
  RedisRequest,
  StompRequest,
  KafkaRequest
} from '../../../shared/types/requests'
import {
  HTTPRequestTabView,
  GraphQLRequestTabView,
  GrpcRequestTabView,
  SoapRequestTabView,
  SoapServerRequestTabView,
  WebSocketRequestTabView,
  SseRequestTabView,
  ODataRequestTabView,
  JsonRpcRequestTabView,
  JsonRpcBatchRequestTabView,
  TrpcRequestTabView,
  AmqpRequestTabView,
  RedisRequestTabView,
  StompRequestTabView,
  KafkaRequestTabView
} from '../components/RequestTabViews'

/**
 * Renderer-only protocol UI registry: maps a request `type` to the tab-view
 * editor element that renders it. This is the component-bearing sibling of the
 * class-free shared `PROTOCOL_REGISTRY` (it lives in the renderer because it
 * imports React tab views, which must never reach the main bundle).
 *
 * The workbench keeps its per-protocol wrapper chrome (breadcrumbs, env
 * provider, header actions — which legitimately differ per protocol); only the
 * INNER editor component is chosen here, so adding a protocol is ONE row rather
 * than a new component-selection `if` branch.
 *
 * `auth` composes onto the HTTP tab view (which injects the extra
 * "Configuration" tab when it sees `type === 'auth'`); `soap` picks the server
 * or client editor from the request's `server` flag. Casts are sound because
 * the map is keyed by the same `type` discriminant the request carries.
 */
export const PROTOCOL_TAB_VIEWS: Record<RequestType, (request: Request) => ReactNode> = {
  http: (request) => <HTTPRequestTabView request={request as HTTPRequest} />,
  auth: (request) => <HTTPRequestTabView request={request as AuthenticationRequest} />,
  graphql: (request) => <GraphQLRequestTabView request={request as GraphQLRequest} />,
  grpc: (request) => <GrpcRequestTabView request={request as GrpcRequest} />,
  soap: (request) => ((request as SoapRequest).server === true
    ? <SoapServerRequestTabView request={request as SoapRequest} />
    : <SoapRequestTabView request={request as SoapRequest} />),
  websocket: (request) => <WebSocketRequestTabView request={request as WebSocketRequest} />,
  sse: (request) => <SseRequestTabView request={request as SseRequest} />,
  odata: (request) => <ODataRequestTabView request={request as ODataRequest} />,
  jsonrpc: (request) => <JsonRpcRequestTabView request={request as JsonRpcRequest} />,
  jsonrpcBatch: (request) => <JsonRpcBatchRequestTabView request={request as JsonRpcBatchRequest} />,
  trpc: (request) => <TrpcRequestTabView request={request as TrpcRequest} />,
  amqp: (request) => <AmqpRequestTabView request={request as AmqpRequest} />,
  redis: (request) => <RedisRequestTabView request={request as RedisRequest} />,
  stomp: (request) => <StompRequestTabView request={request as StompRequest} />,
  kafka: (request) => <KafkaRequestTabView request={request as KafkaRequest} />
}

/**
 * Render the tab-view editor element for a request, chosen by its protocol.
 *
 * `reloadEpoch` is a monotonic counter the host bumps when the whole
 * collection tree is re-hydrated from disk out from under an open tab (a
 * clean git pull fast-forwards new content, replacing the reactive request
 * proxies). Each protocol view seeds its editable fields into local React
 * state ONCE from the `request` prop, so a same-id re-hydration alone leaves
 * the tab showing pre-pull values until it's closed and reopened. Folding the
 * epoch into the view's `key` remounts it on a bump, re-running those
 * initializers against the freshly-hydrated proxy — an automatic reopen. The
 * key is stable while `reloadEpoch` doesn't change, so ordinary re-renders
 * never remount (which would tear down Monaco editors mid-edit).
 */
export function renderProtocolTabView(request: Request, reloadEpoch = 0): ReactNode {
  const view = PROTOCOL_TAB_VIEWS[request.type](request)
  if (!isValidElement(view)) return view
  return cloneElement(view, { key: `${request.id}:${reloadEpoch}` })
}
