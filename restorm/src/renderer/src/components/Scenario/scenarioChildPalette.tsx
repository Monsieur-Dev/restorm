import React, { type ReactNode } from 'react'
import type { BadgeType } from '../common/Badge'
import { RegistryBadge } from '../common/RegistryBadge'
import { resolveBadgeId } from '../../utils/badgeUtils'
import type { AddMenuRequestEntry } from '../MainView/Sidebar/contextMenuBuilder'

/**
 * Catalogue for the scenario graph's "Add" submenu — shared by the right-click
 * full palette and the link-drag palette. The request / server ENTRIES and
 * their per-protocol grouping now live in the sidebar's shared Add-menu model
 * (`ADD_MENU_HTTP_ENTRIES` + `ADD_MENU_PROTOCOL_GROUPS` in `contextMenuBuilder`),
 * so this palette and the sidebar menu read identically: same order, same
 * labels, same registry badge ids. Unlike the sidebar the editor also drops the
 * matching node onto the graph, and a folder is intentionally absent (no node).
 *
 * What stays here is scenario-specific: the ACTION entries (send / close /
 * listen / subscribe …) that fold into each protocol submenu, plus the badge
 * helpers both palettes share. Each palette builds its own `onClick` inline so
 * the node-creation callbacks stay in event handlers (never invoked at render).
 */

/** Render the registry badge for a shared Add-menu request entry — the palette
 * twin of the sidebar's request-entry icon, so both surfaces show the exact
 * same badge (id + text + server capsule) for a given entry. */
export function addMenuEntryBadge(entry: AddMenuRequestEntry): ReactNode {
  return React.createElement(RegistryBadge, {
    badgeId: entry.badgeId,
    ...(entry.text !== undefined && { text: entry.text }),
    ...(entry.server === true && { server: true })
  })
}

/** A protocol NODE action badged straight from a registry id. Covers the four
 * entries that historically rendered unbadged at the palette's top level and
 * now fold into their protocol submenu: `graphqlSubscribe` / `graphqlUnsubscribe`
 * (open / close a GraphQL subscription) and the `redisCommand` / `soapRequest`
 * one-shot request nodes. */
export interface ScenarioAddBadgedNodeEntry {
  kind: 'graphqlSubscribe' | 'graphqlUnsubscribe' | 'redisCommand' | 'soapRequest'
  badgeId: string
  labelKey: string
  defaultLabel: string
}

/** GraphQL subscription actions — subscribe (broadcast glyph) / unsubscribe
 * (disconnect glyph), badged off the GraphQL query color. They drive an
 * existing subscription request, so they live in the GraphQL submenu's action
 * section (after its request entries). */
export const SCENARIO_ADD_GRAPHQL_SUB_ACTIONS: ScenarioAddBadgedNodeEntry[] = [
  { kind: 'graphqlSubscribe', badgeId: 'gql_subscribe', labelKey: 'scenario.nodes.graphqlSubscribe', defaultLabel: 'GraphQL subscribe' },
  { kind: 'graphqlUnsubscribe', badgeId: 'gql_unsubscribe', labelKey: 'scenario.nodes.graphqlUnsubscribe', defaultLabel: 'GraphQL unsubscribe' }
]

/** The one-shot Redis command node — folds into the Redis submenu, badged
 * REDIS. */
export const SCENARIO_ADD_REDIS_COMMAND: ScenarioAddBadgedNodeEntry = {
  kind: 'redisCommand', badgeId: 'redis', labelKey: 'scenario.nodes.redisCommand', defaultLabel: 'Redis command'
}

/** The one-shot SOAP request node — folds into the SOAP submenu, badged SOAP. */
export const SCENARIO_ADD_SOAP_REQUEST: ScenarioAddBadgedNodeEntry = {
  kind: 'soapRequest', badgeId: 'soap', labelKey: 'scenario.nodes.soapRequest', defaultLabel: 'SOAP Request'
}

/** Render the registry badge for a badged NODE action (no text override). */
export function scenarioAddBadgedNodeIcon(badgeId: string): ReactNode {
  return React.createElement(RegistryBadge, { badgeId })
}

/** Socket.IO scenario ACTION entries (a section of the "Add" submenu). Unlike
 * the request groups, these don't create a request — they drop the matching
 * scenario action node directly, driving an ALREADY-declared connection. Their
 * badge is the green "SIO" pill with the action's codicon inside. There is no
 * `connect` action: a connection is created by the Socket.IO request entries
 * (client / server) above — a standalone connect node is useless (its executor
 * throws without a bound `requestId`), so connect mirrors gRPC's request-only
 * creation. */
export interface ScenarioAddActionEntry {
  /** The scenario node kind to create. */
  kind: 'socketioSend' | 'socketioClose'
  /** Codicon glyph shown inside the SIO badge. */
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_SOCKETIO_ACTIONS: ScenarioAddActionEntry[] = [
  { kind: 'socketioSend', icon: 'arrow-up', labelKey: 'scenario.nodes.socketioSend', defaultLabel: 'Socket.IO send' },
  { kind: 'socketioClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.socketioClose', defaultLabel: 'Socket.IO close' }
]

/** Raw-WebSocket action entries — same shape as the Socket.IO section, badged WS
 * (send / close only; connect comes from the request entries). */
export interface ScenarioAddWsActionEntry {
  kind: 'websocketSend' | 'websocketClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_WEBSOCKET_ACTIONS: ScenarioAddWsActionEntry[] = [
  { kind: 'websocketSend', icon: 'arrow-up', labelKey: 'scenario.nodes.websocketSend', defaultLabel: 'WebSocket send' },
  { kind: 'websocketClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.websocketClose', defaultLabel: 'WebSocket close' }
]

/** SSE action entries — CLOSE only (the connect comes from the request entry,
 * which drops a bound sseConnect). SSE is receive-only, so there is no send
 * action — mirrors the HTTP/SOAP/GraphQL server sections' close-only shape. */
export interface ScenarioAddSseActionEntry {
  kind: 'sseClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

/** STOMP action entries — same shape as the raw-WebSocket section, badged
 * STOMP (send / close only; connect comes from the request entry above). */
export interface ScenarioAddStompActionEntry {
  kind: 'stompSend' | 'stompClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_SSE_ACTIONS: ScenarioAddSseActionEntry[] = [
  { kind: 'sseClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.sseClose', defaultLabel: 'SSE close' }
]

export const SCENARIO_ADD_STOMP_ACTIONS: ScenarioAddStompActionEntry[] = [
  { kind: 'stompSend', icon: 'arrow-up', labelKey: 'scenario.nodes.stompSend', defaultLabel: 'STOMP send' },
  { kind: 'stompClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.stompClose', defaultLabel: 'STOMP close' }
]

/** MQTT action entries — publish / close (connect comes from the request entry), badged MQTT. */
export interface ScenarioAddMqttActionEntry {
  kind: 'mqttSend' | 'mqttClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_MQTT_ACTIONS: ScenarioAddMqttActionEntry[] = [
  { kind: 'mqttSend', icon: 'arrow-up', labelKey: 'scenario.nodes.mqttSend', defaultLabel: 'MQTT publish' },
  { kind: 'mqttClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.mqttClose', defaultLabel: 'MQTT close' }
]

/** AMQP action entries — publish / close (connect comes from the request entry,
 * `subscribe` mode only), badged AMQP. */
export interface ScenarioAddAmqpActionEntry {
  kind: 'amqpPublish' | 'amqpClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

/** Kafka action entries — CLOSE only (produce is one-shot and never needs
 * closing; the consume connect comes from the Kafka request entries above),
 * badged KAFKA. */
export interface ScenarioAddKafkaActionEntry {
  kind: 'kafkaClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

/** Redis action entries — CLOSE only (there is no publish/send action: PUBLISH
 * is a command-mode run, not part of the subscribe connection). The connect
 * comes from dragging an existing subscribe-mode request onto the canvas —
 * see `ScenarioEditorView`'s `onDrop`, since (unlike MQTT/WS/SIO) a freshly
 * created Redis request always starts in command mode. */
export interface ScenarioAddRedisActionEntry {
  kind: 'redisClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_AMQP_ACTIONS: ScenarioAddAmqpActionEntry[] = [
  { kind: 'amqpPublish', icon: 'arrow-up', labelKey: 'scenario.nodes.amqpPublish', defaultLabel: 'AMQP publish' },
  { kind: 'amqpClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.amqpClose', defaultLabel: 'AMQP close' }
]

export const SCENARIO_ADD_REDIS_ACTIONS: ScenarioAddRedisActionEntry[] = [
  { kind: 'redisClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.redisClose', defaultLabel: 'Redis close' }
]

export const SCENARIO_ADD_KAFKA_ACTIONS: ScenarioAddKafkaActionEntry[] = [
  { kind: 'kafkaClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.kafkaClose', defaultLabel: 'Kafka close' }
]

/** gRPC streaming action entries — send / close only (badged GRPC). The CONNECT
 * is NOT an action here: a gRPC connection is created by the gRPC request entries
 * (streaming → a bound `grpcConnect`) or by dragging a request, so a separate
 * "connect" action would only add an unbound, redundant node. These send/close
 * actions drive an already-declared connection. */
export interface ScenarioAddGrpcActionEntry {
  kind: 'grpcSend' | 'grpcClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_GRPC_ACTIONS: ScenarioAddGrpcActionEntry[] = [
  { kind: 'grpcSend', icon: 'arrow-up', labelKey: 'scenario.nodes.grpcSend', defaultLabel: 'gRPC send' },
  { kind: 'grpcClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.grpcClose', defaultLabel: 'gRPC close' }
]

/** HTTP mock-server action entries — CLOSE only (the listen comes from the
 * "HTTP server" request entry, which drops a bound httpListen). A hosted mock
 * never SENDS unprompted, so there is no http send action. Badged with the
 * server pill + the close codicon. */
export interface ScenarioAddHttpActionEntry {
  kind: 'httpClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_HTTP_ACTIONS: ScenarioAddHttpActionEntry[] = [
  { kind: 'httpClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.httpClose', defaultLabel: 'HTTP close' }
]

/** gRPC mock-server action entries — CLOSE only (the listen comes from the
 * "gRPC server" request entry, which drops a bound grpcListen). A hosted mock
 * never SENDS unprompted, so there is no gRPC-server send action. */
export interface ScenarioAddGrpcServerActionEntry {
  kind: 'grpcServerClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

/** SOAP mock-server action entries — CLOSE only (the listen comes from the
 * "SOAP server" request entry, which drops a bound soapListen). Mirrors the HTTP
 * section; badged with the server pill + the close codicon. */
export interface ScenarioAddSoapActionEntry {
  kind: 'soapClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_GRPC_SERVER_ACTIONS: ScenarioAddGrpcServerActionEntry[] = [
  { kind: 'grpcServerClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.grpcServerClose', defaultLabel: 'gRPC server close' }
]

export const SCENARIO_ADD_SOAP_ACTIONS: ScenarioAddSoapActionEntry[] = [
  { kind: 'soapClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.soapClose', defaultLabel: 'SOAP close' }
]

/** GraphQL mock-server action entries — CLOSE only (the listen comes from the
 * "GraphQL server" request entry, which drops a bound graphqlListen). A hosted
 * mock never SENDS unprompted, so there is no graphql send action. */
export interface ScenarioAddGraphqlActionEntry {
  kind: 'graphqlClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_GRAPHQL_ACTIONS: ScenarioAddGraphqlActionEntry[] = [
  { kind: 'graphqlClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.graphqlClose', defaultLabel: 'GraphQL close' }
]

/** Render the `badgeRegistry.json` badge for a palette entry, resolving the
 * `(type, mode, action-icon)` triple onto a registry id. Every palette badge —
 * request entry or action entry — flows through this one helper so no palette
 * surface rebuilds a badge by hand. */
function paletteBadge(type: BadgeType, mode: 'server' | undefined, icon: string | undefined): ReactNode {
  const { badgeId, server } = resolveBadgeId(type, mode, icon)
  return React.createElement(RegistryBadge, { badgeId, ...(server === true && { server: true }) })
}

/** The "SIO" badge with the action's codicon inside (Socket.IO section). */
export function scenarioAddSocketioIcon(icon: string): ReactNode {
  return paletteBadge('SIO', undefined, icon)
}

/** The "WS" badge with the action's codicon inside (raw WebSocket section). */
export function scenarioAddWebsocketIcon(icon: string): ReactNode {
  return paletteBadge('WS', undefined, icon)
}

/** The "SSE" badge with the action's codicon inside (SSE section). */
export function scenarioAddSseIcon(icon: string): ReactNode {
  return paletteBadge('SSE', undefined, icon)
}

/** The "GRPC" badge with the action's codicon inside (gRPC streaming section). */
export function scenarioAddGrpcIcon(icon: string): ReactNode {
  return paletteBadge('GRPC', undefined, icon)
}

/** The "MQTT" badge with the action's codicon inside (MQTT section). */
export function scenarioAddMqttIcon(icon: string): ReactNode {
  return paletteBadge('MQTT', undefined, icon)
}

/** The "AMQP" badge with the action's codicon inside (AMQP section). */
export function scenarioAddAmqpIcon(icon: string): ReactNode {
  return paletteBadge('AMQP', undefined, icon)
}

/** The "REDIS" badge with the action's codicon inside (Redis section). */
export function scenarioAddRedisIcon(icon: string): ReactNode {
  return paletteBadge('REDIS', undefined, icon)
}

/** The "STOMP" badge with the action's codicon inside (STOMP section). */
export function scenarioAddStompIcon(icon: string): ReactNode {
  return paletteBadge('STOMP', undefined, icon)
}

/** The "KAFKA" badge with the action's codicon inside (Kafka section). */
export function scenarioAddKafkaIcon(icon: string): ReactNode {
  return paletteBadge('KAFKA', undefined, icon)
}

/** The server-pill HTTP badge (HTTP mock-server close section). The close
 * action's codicon is not shown — the server capsule carries no glyph. */
export function scenarioAddHttpIcon(_icon: string): ReactNode {
  return paletteBadge('GET', 'server', undefined)
}

/** The server-pill SOAP badge (SOAP mock-server close section). */
export function scenarioAddSoapIcon(_icon: string): ReactNode {
  return paletteBadge('SOAP', 'server', undefined)
}

/** The GraphQL mock-server close action's badge (QUERY server pill). */
export function scenarioAddGraphqlIcon(_icon: string): ReactNode {
  return paletteBadge('QUERY', 'server', undefined)
}
