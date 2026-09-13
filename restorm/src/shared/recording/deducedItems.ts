/**
 * Turn a deduction result into the tree items a recording session holds
 * under its Routes node — real folders and replayable requests — merging
 * with what a previous deduction produced so the user's edits survive.
 *
 * Merge rules: a folder is matched by name under its parent; a request by
 * protocol + method + url (the deduced template). Matched items are kept
 * untouched (their edits win); only new routes are added. Each new request
 * is prefilled from the route's last successful call (its headers, query,
 * path parameters and body), so it replays as the page called it.
 */

import type { FolderItem, Folder, HTTPRequest, GraphQLRequest, GrpcRequest, WebSocketRequest, KeyValue, Request } from '../types/collections'
import type { RecordingProtocol } from '../types/recordingSession'
import type { RecordedCallDetail } from '../types/recordingCapture'
import type { DeducedFolder, DeducedRoute, DeducedTree } from './routeDeduction'
import { createTypedKeyValue } from '../utils/createTypedKeyValue'
import { graphqlOperationOf, headerValue } from './classifyCapture'
import { isAnyFolder, isRequest } from '../types/folderTypes'

/** What the history step needs per created request. */
export interface DeducedHistoryPlan {
  requestId: string
  protocol: RecordingProtocol
  /** Chronological captures behind the route. */
  captureIds: string[]
  /** The capture whose response is the reference (the last 2xx) — pinned in the history. */
  referenceCaptureId: string | null
}

/** A node the deduction added, with the container it went into (`null` = the session itself). */
export interface CreatedDeducedItem {
  item: FolderItem
  parentId: string | null
}

export interface MaterializedDeduction {
  /** The session's full `items` after the merge. */
  items: FolderItem[]
  /** Every node that did not exist before — new folders (whose subtree is
   * entirely new) and new requests added under an existing folder — with the
   * container each went into, for the created events. */
  created: CreatedDeducedItem[]
  /** New requests, with their captures, for the history sidecar. */
  history: DeducedHistoryPlan[]
  /** Counts for the user-facing summary. */
  summary: { routes: number; newRoutes: number; folders: number }
}

/** Headers that describe the wire exchange, not the call — never replayed. */
const DROPPED_REQUEST_HEADERS = new Set([
  'content-length', 'host', 'connection', 'accept-encoding', 'origin', 'referer', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'user-agent', 'pragma', 'cache-control', 'if-none-match', 'if-modified-since',
  'x-grpc-web', 'te'
])

function replayableHeaders(detail: RecordedCallDetail | undefined): KeyValue[] {
  if (!detail) return []
  return detail.request.headers
    .filter((h) => !h.key.startsWith(':') && !DROPPED_REQUEST_HEADERS.has(h.key.toLowerCase()))
    .map((h) => createTypedKeyValue({ key: h.key, value: h.value, enabled: true }))
}

function bodyOf(detail: RecordedCallDetail | undefined): string | null {
  const body = detail?.request.body
  if (body?.encoding !== 'utf8') return null
  return body.data
}

function requestKey(protocol: string, method: string, url: string): string {
  return `${protocol}|${method.toUpperCase()}|${url}`
}

function existingRequestKey(item: Request): string {
  const protocol = item.type === 'grpc' ? 'grpc-web' : item.type
  const method = item.type === 'http' ? item.method : item.type === 'websocket' ? 'WS' : 'POST'
  return requestKey(protocol, method, item.url)
}

function newHttpRequest(route: DeducedRoute, reference: RecordedCallDetail | undefined, id: string): HTTPRequest {
  const params: KeyValue[] = route.queryParams.map((q) => createTypedKeyValue({ key: q.key, value: q.lastSuccessValue ?? q.samples[0] ?? '', enabled: q.alwaysPresent || q.lastSuccessValue !== null }))
  const pathParams: KeyValue[] = route.pathParams.map((p) => createTypedKeyValue({ key: p.name, value: p.lastSuccessValue ?? p.samples[0] ?? '', enabled: true }))
  const body = bodyOf(reference)
  // The template carries the placeholders; query params live in the params table.
  return {
    type: 'http',
    id,
    name: route.name,
    tags: [],
    method: route.method,
    url: route.url,
    headers: replayableHeaders(reference),
    params,
    ...(pathParams.length > 0 ? { pathParams } : {}),
    ...(body !== null && route.method !== 'GET' && route.method !== 'HEAD' ? { body: { type: 'text' as const, content: body } } : {})
  }
}

function newGraphqlRequest(route: DeducedRoute, reference: RecordedCallDetail | undefined, id: string): GraphQLRequest {
  const bodyText = bodyOf(reference)
  let query = ''
  let variables: string | undefined
  if (bodyText !== null) {
    try {
      const parsed = JSON.parse(bodyText) as { query?: unknown; variables?: unknown }
      if (typeof parsed.query === 'string') query = parsed.query
      if (parsed.variables !== undefined) variables = JSON.stringify(parsed.variables, null, 2)
    } catch {
      query = bodyText
    }
  }
  const op = route.graphql ?? graphqlOperationOf(query) ?? { operationType: 'query' as const, operationName: null }
  return {
    type: 'graphql',
    id,
    name: route.name,
    tags: [],
    url: route.url,
    operationType: op.operationType,
    query,
    ...(variables !== undefined ? { variables } : {}),
    ...(op.operationName !== null ? { operationName: op.operationName } : {}),
    headers: replayableHeaders(reference)
  }
}

function newGrpcRequest(route: DeducedRoute, reference: RecordedCallDetail | undefined, id: string): GrpcRequest {
  const grpc = route.grpc ?? { service: 'service', method: 'method' }
  return {
    type: 'grpc',
    id,
    name: route.name,
    tags: [],
    url: route.origin,
    service: grpc.service,
    method: grpc.method,
    callType: 'unary',
    requestMessage: bodyOf(reference) ?? '',
    metadata: replayableHeaders(reference),
    transport: 'grpc-web'
  }
}

function newWebSocketRequest(route: DeducedRoute, reference: RecordedCallDetail | undefined, id: string): WebSocketRequest {
  const firstSent = reference?.websocketFrames?.find((f) => f.direction === 'sent' && f.opcode === 1)
  return {
    type: 'websocket',
    id,
    name: route.name,
    tags: [],
    url: route.url,
    protocol: 'websocket',
    message: firstSent?.payload ?? '',
    headers: replayableHeaders(reference).filter((h) => headerValue([{ key: h.key, value: '' }], 'upgrade') === null)
  }
}

function buildRequest(route: DeducedRoute, reference: RecordedCallDetail | undefined, id: string): Request {
  switch (route.protocol) {
    case 'graphql': return newGraphqlRequest(route, reference, id)
    case 'grpc-web': return newGrpcRequest(route, reference, id)
    case 'websocket': return newWebSocketRequest(route, reference, id)
    default: return newHttpRequest(route, reference, id)
  }
}

function newFolder(name: string, id: string): Folder {
  return { id, name, tags: [], configuration: {}, items: [] }
}

export function materializeDeducedTree(
  tree: DeducedTree,
  referenceDetails: ReadonlyMap<string, RecordedCallDetail>,
  existing: readonly FolderItem[] | undefined,
  newId: () => string,
  /** Applied to every new node before it is inserted (the renderer wraps it reactive). */
  wrap: (item: FolderItem, parentId: string | null) => FolderItem = (item) => item
): MaterializedDeduction {
  const items: FolderItem[] = existing ? [...existing] : []
  const created: CreatedDeducedItem[] = []
  const history: DeducedHistoryPlan[] = []
  let routes = 0
  let newRoutes = 0
  let folders = 0

  // `announce` = whether new nodes at this level are reported individually;
  // under a brand-new folder they are not (the folder's created event
  // carries its whole subtree).
  const place = (container: FolderItem[], parentId: string | null, folder: DeducedFolder | DeducedTree, announce: boolean): void => {
    for (const route of folder.routes) {
      routes += 1
      const key = requestKey(route.protocol, route.method, route.url)
      const already = container.find((item): item is Request => isRequest(item) && existingRequestKey(item) === key)
      if (already) continue
      newRoutes += 1
      const reference = route.lastSuccessCaptureId !== null ? referenceDetails.get(route.lastSuccessCaptureId) : undefined
      const request = buildRequest(route, reference, newId())
      const inserted = announce ? wrap(request, parentId) : request
      container.push(inserted)
      if (announce) created.push({ item: inserted, parentId })
      history.push({ requestId: request.id, protocol: route.protocol, captureIds: route.captureIds, referenceCaptureId: route.lastSuccessCaptureId })
    }
    for (const sub of folder.folders) {
      const target = container.find((item): item is Folder => isAnyFolder(item) && item.name === sub.name)
      if (target) {
        place(target.items, target.id, sub, announce)
        continue
      }
      folders += 1
      const fresh = newFolder(sub.name, newId())
      // Fill the plain folder first, then wrap + announce it once.
      place(fresh.items, fresh.id, sub, false)
      const inserted = announce ? wrap(fresh, parentId) : fresh
      container.push(inserted)
      if (announce) created.push({ item: inserted, parentId })
    }
  }
  place(items, null, tree, true)
  return { items, created, history, summary: { routes, newRoutes, folders } }
}
