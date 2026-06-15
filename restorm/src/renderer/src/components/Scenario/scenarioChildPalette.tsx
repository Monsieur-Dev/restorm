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
 * scenario action node directly. Their badge is the green "SIO" pill with the
 * action's codicon inside (connect / send / close). */
export interface ScenarioAddActionEntry {
  /** The scenario node kind to create. */
  kind: 'socketioConnect' | 'socketioSend' | 'socketioClose'
  /** Codicon glyph shown inside the SIO badge. */
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_SOCKETIO_ACTIONS: ScenarioAddActionEntry[] = [
  { kind: 'socketioConnect', icon: 'plug', labelKey: 'scenario.nodes.socketioConnect', defaultLabel: 'Socket.IO connect' },
  { kind: 'socketioSend', icon: 'arrow-up', labelKey: 'scenario.nodes.socketioSend', defaultLabel: 'Socket.IO send' },
  { kind: 'socketioClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.socketioClose', defaultLabel: 'Socket.IO close' }
]

/** Raw-WebSocket action entries — same shape as the Socket.IO section, badged WS. */
export interface ScenarioAddWsActionEntry {
  kind: 'websocketConnect' | 'websocketSend' | 'websocketClose'
  icon: string
  labelKey: string
  defaultLabel: string
}

export const SCENARIO_ADD_WEBSOCKET_ACTIONS: ScenarioAddWsActionEntry[] = [
  { kind: 'websocketConnect', icon: 'plug', labelKey: 'scenario.nodes.websocketConnect', defaultLabel: 'WebSocket connect' },
  { kind: 'websocketSend', icon: 'arrow-up', labelKey: 'scenario.nodes.websocketSend', defaultLabel: 'WebSocket send' },
  { kind: 'websocketClose', icon: 'debug-disconnect', labelKey: 'scenario.nodes.websocketClose', defaultLabel: 'WebSocket close' }
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

/** The protocol/scenario badge glyph for a palette entry. */
export function scenarioAddIcon(badge: BadgeType): ReactNode {
  return React.createElement(Badge, { type: badge })
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
