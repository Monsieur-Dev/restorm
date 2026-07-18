import { createContext, useContext } from 'react'

/**
 * The Socket.IO connections declared in the current scenario — one entry per
 * `socketioConnect` node, `{ id, name }`. The editor provides it so a
 * `socketioSend` / `socketioClose` box can offer a connection picker that stays
 * in sync as connect nodes are added / renamed / deleted (the implicit link the
 * send/close nodes reference by node id, displayed by the connect node's name).
 *
 * Empty (no provider) when a box renders outside the editor — the picker then
 * shows just its persisted reference.
 */
export interface ScenarioConnectionRef {
  id: string
  name: string
  /** The connect node's kind — a send/close picker shows only its own transport's
   * connections (`socketioConnect` vs `websocketConnect` vs `stompConnect` vs
   * `grpcConnect` vs `mqttConnect` vs `kafkaConsume`; `httpListen` for a hosted
   * HTTP mock server, `grpcListen` for a gRPC one, `soapListen` for a SOAP one,
   * `graphqlListen` for a GraphQL one, `odataListen` for an OData one). */
  kind: 'socketioConnect' | 'websocketConnect' | 'stompConnect' | 'sseConnect' | 'grpcConnect' | 'mqttConnect' | 'amqpConnect' | 'redisSubscribe' | 'kafkaConsume' | 'httpListen' | 'grpcListen' | 'soapListen' | 'graphqlListen' | 'odataListen'
  /** True when the connect node's bound request HOSTS a server (`server: true`) —
   * i.e. this connection is a hosted WS/SIO mock server, not a client connection.
   * Same source of truth as a box's `isServerBound`. Lets a picker split a
   * server-close (server connections only) from a client close (clients only). */
  isServer?: boolean
  /** The connect node's linked request event — pre-fills a send node's channel. */
  defaultChannel?: string
  /** The connect node's linked request message — pre-fills a send node's payload. */
  defaultPayload?: string
}

/** The `kind` a ConnectionPicker filters on — the ScenarioConnectionRef kinds
 * plus `graphqlSubscribe` (the graphqlUnsubscribe node's target; a subscription
 * isn't tracked as a ScenarioConnectionRef, so that value simply matches none). */
export type ConnectionPickerKind = ScenarioConnectionRef['kind'] | 'graphqlSubscribe'

export const ScenarioConnectionsContext = createContext<ScenarioConnectionRef[]>([])

export function useScenarioConnections(): ScenarioConnectionRef[] {
  return useContext(ScenarioConnectionsContext)
}
