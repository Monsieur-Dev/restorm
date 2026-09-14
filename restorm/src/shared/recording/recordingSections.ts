/**
 * Recording-session sidebar + tab vocabulary — single source of truth for
 * the session's codicon, its VIRTUAL child rows (browser / captures /
 * routes), their sidebar row ids and the workbench tab ids.
 *
 * A session's row expands into three virtual rows. They are not tree
 * items: the browser row exists only while a recording runs, the captures
 * row is always there (with an empty state), the routes row is always
 * last and hangs the deduced routes (`session.items`, real items) under
 * it. Each row — and the session itself — opens its OWN workbench tab.
 */

import type { Icon } from 'electron-core-ui/types'

/** The session's codicon, everywhere it appears. */
export const RECORDING_CODICON = 'record'

/** The virtual rows under a session, in display order. */
export type RecordingNodeKind = 'browser' | 'captures' | 'routes'

/** What a recording tab shows: the session's config, or one of its nodes. */
export type RecordingTabNode = 'config' | RecordingNodeKind

export interface RecordingNodeSpec {
  key: RecordingNodeKind
  icon: Icon
  /** i18n key of the row label (`recording.node.<key>`). */
  labelKey: string
  /** i18n key of the tab title (`recording.tab.<key>Title`, `{{name}}` = the session). */
  tabTitleKey: string
}

export const RECORDING_NODES: readonly RecordingNodeSpec[] = [
  { key: 'browser', icon: { type: 'codicon', value: 'device-camera-video' }, labelKey: 'recording.node.browser', tabTitleKey: 'recording.tab.browserTitle' },
  { key: 'captures', icon: { type: 'codicon', value: 'list-unordered' }, labelKey: 'recording.node.captures', tabTitleKey: 'recording.tab.capturesTitle' },
  { key: 'routes', icon: { type: 'phosphor', value: 'RoadHorizon' }, labelKey: 'recording.node.routes', tabTitleKey: 'recording.tab.routesTitle' }
]

export function recordingNodeSpec(kind: RecordingNodeKind): RecordingNodeSpec {
  const spec = RECORDING_NODES.find((n) => n.key === kind)
  if (spec === undefined) throw new Error(`unknown recording node: ${kind}`)
  return spec
}

const NODE_ROW_PREFIX = 'recording-node:'

/** Sidebar row id of a session's virtual node row. Not a tree-item id. */
export function recordingNodeRowId(sessionId: string, kind: RecordingNodeKind): string {
  return `${NODE_ROW_PREFIX}${sessionId}:${kind}`
}

/** Parse a sidebar row id back into `{ sessionId, kind }`, or `null` for
 * anything that is not a recording node row. Session ids are UUIDs (no
 * colon), so the last colon separates the kind. */
export function parseRecordingNodeRowId(rowId: string): { sessionId: string; kind: RecordingNodeKind } | null {
  if (!rowId.startsWith(NODE_ROW_PREFIX)) return null
  const rest = rowId.slice(NODE_ROW_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return null
  const sessionId = rest.slice(0, sep)
  const kind = rest.slice(sep + 1)
  if (!RECORDING_NODES.some((n) => n.key === kind)) return null
  return { sessionId, kind: kind as RecordingNodeKind }
}

const CONFIG_TAB_PREFIX = 'recording-id:'
const NODE_TAB_PREFIX = 'recording-node-id:'

/** Workbench tab id of a session's tab: the config tab is keyed like every
 * item tab (`recording-id:<id>`), a node tab adds the node. */
export function recordingTabId(sessionId: string, node: RecordingTabNode): string {
  return node === 'config' ? `${CONFIG_TAB_PREFIX}${sessionId}` : `${NODE_TAB_PREFIX}${sessionId}:${node}`
}

export function parseRecordingTabId(tabId: string): { sessionId: string; node: RecordingTabNode } | null {
  if (tabId.startsWith(CONFIG_TAB_PREFIX)) {
    const sessionId = tabId.slice(CONFIG_TAB_PREFIX.length)
    return sessionId === '' ? null : { sessionId, node: 'config' }
  }
  if (!tabId.startsWith(NODE_TAB_PREFIX)) return null
  const rest = tabId.slice(NODE_TAB_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return null
  const sessionId = rest.slice(0, sep)
  const node = rest.slice(sep + 1)
  if (!RECORDING_NODES.some((n) => n.key === node)) return null
  return { sessionId, node: node as RecordingNodeKind }
}
