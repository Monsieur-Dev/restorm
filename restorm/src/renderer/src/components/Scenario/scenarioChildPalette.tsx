import React, { type ReactNode } from 'react'
import { Badge, type BadgeType } from '../common/Badge'
import type { AddChildKind } from '../MainView/Sidebar/contextMenuBuilder'

/**
 * Catalogue for the scenario graph's "Add" submenu — shared by the right-click
 * full palette and the link-drag palette. It mirrors the sidebar's new-item
 * menu (create a child request of any protocol, or a sub-scenario, under the
 * open scenario) but, unlike the sidebar, the editor also drops the matching
 * node onto the graph. `folder` is intentionally absent: a folder has no node.
 *
 * Only the *data* lives here; each palette builds its own `onClick` inline so
 * the node-creation callbacks stay in event handlers (never invoked at render).
 */
export interface ScenarioAddEntry {
  kind: AddChildKind
  badge: BadgeType
  /** Server-mode badge (the two-part "hosts a server" pill) — set for the
   * websocket-server / socketio-server / mqtt-server entries, matching the
   * sidebar menu. */
  mode?: 'server'
  /** i18n key (shared with the sidebar menu) + English fallback. */
  labelKey: string
  defaultLabel: string
}

/** Request kinds, grouped exactly like the sidebar menu (HTTP methods, the
 * other protocols, then the auth request) — the separators between groups. */
export const SCENARIO_ADD_REQUEST_GROUPS: ScenarioAddEntry[][] = [
  [
    { kind: 'http-get', badge: 'GET', labelKey: 'sidebar.contextMenu.add.httpGet', defaultLabel: 'HTTP request – GET' },
    { kind: 'http-post', badge: 'POST', labelKey: 'sidebar.contextMenu.add.httpPost', defaultLabel: 'HTTP request – POST' },
    { kind: 'http-put', badge: 'PUT', labelKey: 'sidebar.contextMenu.add.httpPut', defaultLabel: 'HTTP request – PUT' },
    { kind: 'http-patch', badge: 'PATCH', labelKey: 'sidebar.contextMenu.add.httpPatch', defaultLabel: 'HTTP request – PATCH' },
    { kind: 'http-delete', badge: 'DELETE', labelKey: 'sidebar.contextMenu.add.httpDelete', defaultLabel: 'HTTP request – DELETE' }
  ],
  // gRPC — its own group (the four call types) right after HTTP, mirroring the
  // sidebar. Creating one from the palette makes a gRPC request of that call type
  // + the matching node: unary → a one-shot request node; server / client / bidi
  // → a grpcConnect (the box shows the call-type badge, so the stream direction
  // stays visible). The connect / send / close action section below stays for
  // driving an ALREADY-declared connection.
  [
    { kind: 'grpc', badge: 'UNARY', labelKey: 'sidebar.contextMenu.add.grpc', defaultLabel: 'gRPC request' },
    { kind: 'grpc-server-stream', badge: 'S-STR', labelKey: 'sidebar.contextMenu.add.grpcServerStream', defaultLabel: 'gRPC server-streaming request' },
    { kind: 'grpc-client-stream', badge: 'C-STR', labelKey: 'sidebar.contextMenu.add.grpcClientStream', defaultLabel: 'gRPC client-streaming request' },
    { kind: 'grpc-bidi', badge: 'BIDI', labelKey: 'sidebar.contextMenu.add.grpcBidi', defaultLabel: 'gRPC bidirectional request' }
  ],
  // Streaming protocols — their CONNECT comes from creating a request (client or
  // SERVER), mirroring both the sidebar menu and the gRPC entries above: the
  // matching `*Connect` node is dropped bound to the new request (a connect node
  // is useless unbound — its executor throws without a `requestId`). The
  // send/close actions below drive an ALREADY-declared connection.
  [
    { kind: 'websocket', badge: 'WS', labelKey: 'sidebar.contextMenu.add.websocket', defaultLabel: 'WebSocket request' },
    { kind: 'websocket-server', badge: 'WS', mode: 'server', labelKey: 'sidebar.contextMenu.add.websocketServer', defaultLabel: 'WebSocket server' },
    { kind: 'socketio', badge: 'SIO', labelKey: 'sidebar.contextMenu.add.socketio', defaultLabel: 'Socket.IO request' },
    { kind: 'socketio-server', badge: 'SIO', mode: 'server', labelKey: 'sidebar.contextMenu.add.socketioServer', defaultLabel: 'Socket.IO server' },
    { kind: 'mqtt', badge: 'MQTT', labelKey: 'sidebar.contextMenu.add.mqtt', defaultLabel: 'MQTT request' },
    { kind: 'mqtt-server', badge: 'MQTT', mode: 'server', labelKey: 'sidebar.contextMenu.add.mqttServer', defaultLabel: 'MQTT broker' },
    // HTTP mock server is server-only (a one-shot HTTP request already has its own
    // method entries above): dropping it creates a server: true request + a bound
    // httpListen node.
    { kind: 'http-server', badge: 'GET', mode: 'server', labelKey: 'sidebar.contextMenu.add.httpServer', defaultLabel: 'HTTP server' }
  ],
  [
    { kind: 'graphql', badge: 'QUERY', labelKey: 'sidebar.contextMenu.add.graphql', defaultLabel: 'GraphQL request' },
    { kind: 'soap', badge: 'SOAP', labelKey: 'sidebar.contextMenu.add.soap', defaultLabel: 'SOAP request' },
    { kind: 'odata', badge: 'ODATA', labelKey: 'sidebar.contextMenu.add.odata', defaultLabel: 'OData request' }
  ],
  [
    { kind: 'auth', badge: 'AUTH', labelKey: 'sidebar.contextMenu.add.auth', defaultLabel: 'Authentication HTTP request' }
  ]
]

/** The sub-scenario entry (its own group, after the request groups). */
export const SCENARIO_ADD_SCENARIO_ENTRY: ScenarioAddEntry = {
  kind: 'scenario', badge: 'SCENARIO', labelKey: 'sidebar.contextMenu.add.scenario', defaultLabel: 'Scenario'
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

/** The protocol/scenario badge glyph for a palette entry — `mode: 'server'`
 * renders the two-part "hosts a server" pill (websocket-server / socketio-server). */
export function scenarioAddIcon(badge: BadgeType, mode?: 'server'): ReactNode {
  return React.createElement(Badge, { type: badge, ...(mode ? { mode } : {}) })
}

/** The green "SIO" badge with the action's codicon inside (Socket.IO section). */
export function scenarioAddSocketioIcon(icon: string): ReactNode {
  return React.createElement(Badge, { type: 'SIO', icon })
}

/** The "WS" badge with the action's codicon inside (raw WebSocket section). */
export function scenarioAddWebsocketIcon(icon: string): ReactNode {
  return React.createElement(Badge, { type: 'WS', icon })
}

/** The "GRPC" badge with the action's codicon inside (gRPC streaming section). */
export function scenarioAddGrpcIcon(icon: string): ReactNode {
  return React.createElement(Badge, { type: 'GRPC', icon })
}

/** The "MQTT" badge with the action's codicon inside (MQTT section). */
export function scenarioAddMqttIcon(icon: string): ReactNode {
  return React.createElement(Badge, { type: 'MQTT', icon })
}

/** The server-pill HTTP badge with the action's codicon inside (HTTP section). */
export function scenarioAddHttpIcon(icon: string): ReactNode {
  return React.createElement(Badge, { type: 'GET', mode: 'server', icon })
}
