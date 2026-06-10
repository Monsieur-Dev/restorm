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
  [
    { kind: 'graphql', badge: 'QUERY', labelKey: 'sidebar.contextMenu.add.graphql', defaultLabel: 'GraphQL request' },
    { kind: 'grpc', badge: 'UNARY', labelKey: 'sidebar.contextMenu.add.grpc', defaultLabel: 'gRPC request' },
    { kind: 'soap', badge: 'SOAP', labelKey: 'sidebar.contextMenu.add.soap', defaultLabel: 'SOAP request' },
    { kind: 'websocket', badge: 'WS', labelKey: 'sidebar.contextMenu.add.websocket', defaultLabel: 'WebSocket request' },
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

/** The protocol/scenario badge glyph for a palette entry. */
export function scenarioAddIcon(badge: BadgeType): ReactNode {
  return React.createElement(Badge, { type: badge })
}
