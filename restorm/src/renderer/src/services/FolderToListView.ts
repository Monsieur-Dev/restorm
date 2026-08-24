/**
 * Utility to convert Folder structure to ListView items
 */

import type { ListViewItemData } from 'electron-core-ui/renderer'
import { IconView, i18n } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { Folder, FolderItem, HTTPRequest, EnvironmentFolder, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, SseRequest, ODataRequest, AuthenticationRequest, AmqpRequest, Scenario, Environment, Request, ApiDesign } from '../../../shared/types/collections'
import { isFolder, isRequest, isHTTPRequest, isEnvironmentFolder, isAnyFolder, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isSseRequest, isODataRequest, isAuthenticationRequest, isAmqpRequest, isScenario, isApiDesign } from '../../../shared/types/collections'
import { SIDEBAR_DESIGN_SECTIONS, DESIGN_CODICON, designSectionRowId } from '../../../shared/design/designSections'
import { getDesignClients, designClientRowId } from './designClientsStore'
import { validateApiDesign } from '../../../shared/design/validateApiDesign'

import { requestBadgeMode } from '../utils/badgeUtils'
import React, { type ReactNode } from 'react'
import { ScenarioRunningBadge } from '../components/common/ScenarioRunningBadge'
import { ServerListeningBadge } from '../components/common/ServerListeningBadge'
import { RequestExecutingBadge } from '../components/common/RequestExecutingBadge'

/** Wrap a request badge so it runs the running-beam while the request executes. */
function withExecutingBeam(requestId: string, badge: ReactNode): ReactNode {
  return badge != null ? React.createElement(RequestExecutingBadge, { requestId }, badge) : badge
}

/** Wrap a long-running / server request badge so the border-beam orbits it while
 * the request is listening (HTTP mock host, WS/SIO/MQTT server, gRPC stream) —
 * the same beam shown on the workbench tab, driven by the same listening state. */
function withListeningBeam(requestId: string, badge: ReactNode): ReactNode {
  return badge != null ? React.createElement(ServerListeningBadge, { requestId }, badge) : badge
}
import { SecretResolvingSpinner } from '../components/common/SecretResolvingSpinner'
import { SecretErrorIndicator } from '../components/common/SecretErrorIndicator'
import { ItemSecretBadges } from '../components/common/ItemSecretBadges'

/** Collect every environment id under a folder (own + nested sub-environments). */
export function collectFolderEnvIds(environments: Environment[]): string[] {
  const ids: string[] = []
  for (const env of environments) {
    ids.push(env.id)
    if (env.subEnvironments) ids.push(...collectFolderEnvIds(env.subEnvironments))
  }
  return ids
}

/** Convert an Icon to a ListView-compatible icon (string for codicons, ReactNode for others) */
function toListViewIcon(icon: Icon | undefined, fallback: string): string | ReactNode {
  if (!icon || icon.type === 'none') return fallback
  if (icon.type === 'codicon') return icon.value
  return React.createElement(IconView, { icon, size: 16 })
}

export interface FolderToListViewOptions {
  /** Set of expanded item IDs */
  expandedIds: Set<string>
  /** Function to render HTTP method badge as leftActions */
  renderMethodBadge: (method: string) => ReactNode
  /** Function to render protocol badge as leftActions. `mode` lets a request
   * that restorm HOSTS (server) render the uniform server variant of its
   * protocol badge. */
  renderProtocolBadge?: (protocol: string, label?: string, mode?: 'client' | 'server') => ReactNode
  /** Function to render a request's badge straight from the protocol registry
   * (badge label, server-capsule mode, and sub-type glyph) — the same badge the
   * workbench tab shows. Used by the generic fallback so every protocol without
   * a dedicated handler still gets its tab-accurate badge instead of a blank
   * icon (the string-keyed {@link renderProtocolBadge} can't reproduce the fixed
   * `RPC` / `RPC[]` / `tRPC` labels or the Kafka mode glyph). */
  renderRequestBadge?: (request: Request) => ReactNode
  /** Function to render removed-from-spec request title — strikethrough. */
  renderRemovedTitle?: (name: string) => ReactNode
  /** Set of request ids whose URL resolves to a deprecated operation
   * in the owning env folder's apiDocumentation. Both the title and
   * the method badge get wrapped in a `opacity: 0.5` span so the
   * whole row reads as dimmed, while the row stays selectable +
   * executable. The check rides on the live matcher (see
   * `useDeprecatedRequestIds`); editing a URL re-evaluates the row
   * instantly. */
  deprecatedRequestIds?: ReadonlySet<string>
}

const DEPRECATED_DIM_STYLE: React.CSSProperties = { opacity: 0.5 }
const DEPRECATED_DIM_TITLE = 'Deprecated in source spec'

function dimNode(node: ReactNode): ReactNode {
  return React.createElement('span', { style: DEPRECATED_DIM_STYLE, title: DEPRECATED_DIM_TITLE }, node)
}

/**
 * Wrap title + icon in dimming spans when the request id is in the
 * deprecated set. We dim BOTH so the method badge fades alongside
 * the name — a row halfway dimmed reads as "something's wrong with
 * the badge" rather than "this whole route is deprecated".
 */
function applyDeprecatedDimming(
  request: { id: string; name: string },
  options: FolderToListViewOptions,
  baseTitle: ReactNode,
  baseIcon: ReactNode
): { title: ReactNode; icon: ReactNode } {
  if (options.deprecatedRequestIds?.has(request.id) === true) {
    return { title: dimNode(baseTitle), icon: dimNode(baseIcon) }
  }
  return { title: baseTitle, icon: baseIcon }
}

/**
 * Convert an HTTPRequest to a ListViewItemData
 */
function decorateRequestTitle(name: string, request: HTTPRequest, options: FolderToListViewOptions): React.ReactNode | string {
  // Removed (vanished from the spec) gets the strikethrough treatment
  // — distinct from the deprecation dim because the two states have
  // different semantics: deprecated = "still in spec, author asks
  // you to migrate"; removed = "spec dropped this entirely".
  if (request.removed === true) return options.renderRemovedTitle?.(name) ?? name
  return name
}

function httpRequestToListViewItem(
  request: HTTPRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  // An HTTP mock SERVER (server === true) renders the SRV capsule variant of its
  // method badge so it's distinct from a normal request in the tree — mirrors
  // the WebSocket/Socket.IO server entries. The method doubles as the route's
  // method, so it stays the badge label.
  const badge = request.server === true
    ? options.renderProtocolBadge?.(request.method, undefined, 'server') ?? options.renderMethodBadge(request.method)
    : options.renderMethodBadge(request.method)
  const decorated = applyDeprecatedDimming(
    request,
    options,
    decorateRequestTitle(request.name, request, options),
    badge
  )
  return {
    id: request.id,
    title: decorated.title,
    // A mock SERVER beams while listening (like WS/SIO/MQTT); a normal request
    // beams only while it executes.
    icon: request.server === true
      ? withListeningBeam(request.id, decorated.icon)
      : withExecutingBeam(request.id, decorated.icon)
  }
}

/**
 * Convert a GraphQLRequest to a ListViewItemData
 */
function graphqlRequestToListViewItem(
  request: GraphQLRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  // A GraphQL mock SERVER (server === true) renders the SRV capsule over its
  // badge + the listening beam while it hosts (like the HTTP / gRPC / WS / SIO /
  // MQTT servers); a client GraphQL request shows the fixed GQL badge (the
  // protocol registry's badge, same as the workbench tab and scenario nodes) + the
  // executing beam.
  if (request.server === true) {
    const badge = options.renderProtocolBadge?.('gql', undefined, 'server')
    return {
      id: request.id,
      title: request.name,
      icon: withListeningBeam(request.id, badge)
    }
  }
  const badge = options.renderProtocolBadge?.('gql')
  return {
    id: request.id,
    title: request.name,
    icon: withExecutingBeam(request.id, badge)
  }
}

/**
 * Convert a GrpcRequest to a ListViewItemData
 */
function grpcRequestToListViewItem(
  request: GrpcRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  // A gRPC mock server renders the uniform SRV capsule over the `grpc` badge
  // (and the listening beam), like the WS/SIO/MQTT/HTTP servers; a client gRPC
  // request keeps its call-type badge + the executing beam.
  if (request.server === true) {
    const badge = options.renderProtocolBadge?.('grpc', undefined, 'server')
    return {
      id: request.id,
      title: request.name,
      icon: withListeningBeam(request.id, badge)
    }
  }
  const badge = options.renderProtocolBadge?.(request.callType)
  return {
    id: request.id,
    title: request.name,
    icon: withExecutingBeam(request.id, badge)
  }
}

/**
 * Convert a SoapRequest to a ListViewItemData
 */
function soapRequestToListViewItem(
  request: SoapRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const isServer = request.server === true
  const badge = options.renderProtocolBadge?.('soap', undefined, isServer ? 'server' : undefined)
  return {
    id: request.id,
    title: request.name,
    // A hosted SOAP mock shows the listening beam (like the WS/HTTP servers); a
    // client request shows the executing beam.
    icon: isServer ? withListeningBeam(request.id, badge) : withExecutingBeam(request.id, badge)
  }
}

/**
 * Convert a WebSocketRequest to a ListViewItemData
 */
function websocketRequestToListViewItem(
  request: WebSocketRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.(request.protocol, undefined, request.server === true ? 'server' : undefined)
  return {
    id: request.id,
    title: request.name,
    icon: withListeningBeam(request.id, badge)
  }
}

/**
 * Convert an ODataRequest to a ListViewItemData. Shows a dedicated
 * `odata` badge so entries don't masquerade as plain HTTP GETs in the
 * sidebar. An OData mock SERVER (server === true) renders the uniform
 * SRV capsule over the `odata` badge (and the listening beam), like the
 * HTTP/gRPC mock servers.
 */
function odataRequestToListViewItem(
  request: ODataRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  if (request.server === true) {
    const badge = options.renderProtocolBadge?.('odata', 'ODATA', 'server')
    return {
      id: request.id,
      title: request.name,
      icon: withListeningBeam(request.id, badge)
    }
  }
  const badge = options.renderProtocolBadge?.('odata', 'ODATA')
  return {
    id: request.id,
    title: request.name,
    icon: withExecutingBeam(request.id, badge)
  }
}

/**
 * Convert an AuthenticationRequest to a ListViewItemData. Auth
 * requests render a key-icon badge instead of the HTTP method
 * (so they stand out in the tree when the importer creates them).
 */
function authenticationRequestToListViewItem(
  request: AuthenticationRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.('auth', 'AUTH')
  return {
    id: request.id,
    title: request.name,
    icon: withExecutingBeam(request.id, badge)
  }
}

/**
 * Convert an AmqpRequest to a ListViewItemData. Not server-capable (v1) —
 * always the listening beam (lit only while a `subscribe` connection is
 * open), never the SRV capsule.
 */
function amqpRequestToListViewItem(
  request: AmqpRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.('amqp', 'AMQP')
  return {
    id: request.id,
    title: request.name,
    icon: withListeningBeam(request.id, badge)
  }
}

/**
 * Convert an SseRequest to a ListViewItemData. SSE keeps an open client
 * connection, so it wears the listening beam (driven by the same SSE listening
 * state the workbench tab reads) rather than the one-shot executing beam — the
 * only client protocol here that does, which is why it has its own handler
 * instead of riding the generic fallback below.
 */
function sseRequestToListViewItem(
  request: SseRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderRequestBadge?.(request)
  return {
    id: request.id,
    title: request.name,
    icon: withListeningBeam(request.id, badge)
  }
}

/**
 * Registry-driven fallback for any request whose protocol has no dedicated
 * handler above (STOMP, Redis, JSON-RPC, JSON-RPC batch, tRPC, Kafka — and any
 * protocol added later). It renders the exact badge the workbench tab shows —
 * label + server capsule + sub-type glyph — from the protocol registry, so a
 * new protocol picks up a correct sidebar badge automatically instead of
 * falling through to a blank icon. A server-hosted request beams while
 * listening; every other request beams while it executes.
 */
function genericRequestToListViewItem(
  request: Request,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderRequestBadge?.(request)
  const isServer = requestBadgeMode(request) === 'server'
  return {
    id: request.id,
    title: request.name,
    icon: isServer
      ? withListeningBeam(request.id, badge)
      : withExecutingBeam(request.id, badge)
  }
}

/**
 * Convert a Scenario to a ListViewItemData. Renders the circuit-board
 * scenario badge so dataflow graphs are visually distinct from requests.
 * A scenario doubles as a folder-like container: its `items` (requests +
 * sub-folders authored inside it) render as expandable children.
 */
function scenarioToListViewItem(
  scenario: Scenario,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.('scenario', 'SCENARIO')
  // Decorate the badge with the live-run border-beam (lit while the scenario
  // has an in-flight run), the same orbiting trail the graph paints on a
  // running node box.
  const icon = badge != null
    ? React.createElement(ScenarioRunningBadge, { scenarioId: scenario.id }, badge)
    : badge
  const isExpanded = options.expandedIds.has(scenario.id)
  const children = (scenario.items ?? []).map((item) => folderItemToListViewItem(item, options))
  return {
    id: scenario.id,
    title: scenario.name,
    isExpandable: children.length > 0,
    isExpanded,
    icon,
    children
  }
}

/**
 * Convert an ApiDesign to a ListViewItemData: the design node plus its
 * VIRTUAL group entries (one per Design-tab section — never one row per
 * model/route). The virtual rows are not tree items: their ids parse via
 * `parseDesignSectionRowId`, clicks refocus the design tab on the
 * section, and drag & drop refuses them wholesale.
 */
/** Namespace a converted client row (and its whole subtree) so the sidebar id
 *  marks it as a TRANSIENT client node, never colliding with a tree item, and
 *  so the click handler can route it back to the client store. */
function prefixClientRow(node: ListViewItemData, designId: string, expanded: Set<string>): ListViewItemData {
  const id = designClientRowId(designId, node.id)
  const children = node.children?.map((child) => prefixClientRow(child, designId, expanded))
  return {
    ...node,
    id,
    // Transient rows are never persisted, so never draggable.
    draggable: false,
    ...(children ? { children, isExpanded: expanded.has(id) } : {})
  }
}

/** One folder per served protocol, each holding that protocol's imported
 *  (transient) client requests — the children hung under the Clients row while
 *  the design is served. Empty when the server is stopped. */
function designClientsChildren(design: ApiDesign, options: FolderToListViewOptions): ListViewItemData[] {
  return getDesignClients(design.id).map((bundle) => {
    const folderId = designClientRowId(design.id, `proto:${bundle.protocol}`)
    const children = bundle.items.map((item) =>
      prefixClientRow(folderItemToListViewItem(item, options), design.id, options.expandedIds)
    )
    return {
      id: folderId,
      title: i18n.t(`design.protocol.${bundle.protocol}`),
      icon: toListViewIcon({ type: 'codicon', value: 'folder' }, ''),
      draggable: false,
      isExpandable: children.length > 0,
      isExpanded: options.expandedIds.has(folderId),
      children
    }
  })
}

function designToListViewItem(
  design: ApiDesign,
  options: FolderToListViewOptions
): ListViewItemData {
  // Wrapped in the executing-beam like a request's badge: the beam runs
  // while the design server serves (the design id rides the same
  // activity store surfaces as a request id).
  const badge = withExecutingBeam(design.id, options.renderProtocolBadge?.('design', 'DESIGN'))
  const isExpanded = options.expandedIds.has(design.id)

  // Validation drives the end-of-row error dots: each issue's path[1]
  // is the faulty entity's id, which maps back to the section holding
  // it. The design node itself gets a dot when ANY section has one.
  const issues = validateApiDesign(design)
  const modelIds = new Set(design.models.map((m) => m.id))
  const enumIds = new Set(design.enums.map((e) => e.id))
  const sectionsInError = new Set<string>()
  for (const issue of issues) {
    const entityId = issue.path[1]
    if (entityId === undefined) continue
    if (modelIds.has(entityId)) sectionsInError.add('models')
    else if (enumIds.has(entityId)) sectionsInError.add('enums')
    else sectionsInError.add('routes')
  }
  const errorDot = (testId: string): ReactNode => React.createElement('span', {
    className: 'design-error-dot codicon codicon-error',
    'data-testid': testId
  })

  const children: ListViewItemData[] = SIDEBAR_DESIGN_SECTIONS.map((section) => {
    const count = section.count(design)
    const parts: ReactNode[] = []
    if (sectionsInError.has(section.key)) parts.push(errorDot(`design-section-error-${section.key}`))
    if (count !== null && count > 0) parts.push(String(count))
    const rowId = designSectionRowId(design.id, section.key)
    // The Clients row is the one section that grows children: the transient
    // per-protocol client requests, present only while the design is served.
    const clientChildren = section.key === 'clients' ? designClientsChildren(design, options) : []
    return {
      id: rowId,
      title: i18n.t(section.labelKey),
      icon: toListViewIcon(section.icon, ''),
      // Virtual section rows are navigation shortcuts, not movable entities —
      // never draggable (a drag would carry no meaningful item id).
      draggable: false,
      ...(clientChildren.length > 0
        ? { isExpandable: true, isExpanded: options.expandedIds.has(rowId), children: clientChildren }
        : {}),
      ...(parts.length > 0
        ? { rightActions: React.createElement('span', { className: 'design-section-count' }, ...parts) }
        : {})
    }
  })
  return {
    id: design.id,
    title: design.name,
    isExpandable: true,
    isExpanded,
    icon: badge ?? DESIGN_CODICON,
    children,
    ...(issues.length > 0 ? { rightActions: errorDot(`design-error-${design.id}`) } : {})
  }
}

/**
 * Convert a FolderItem (Folder, EnvironmentFolder, or Request) to ListViewItemData
 */
export function folderItemToListViewItem(
  item: FolderItem,
  options: FolderToListViewOptions
): ListViewItemData {
  // Requests + scenarios carry a secret badge (spinner / red error) just after
  // their name, driven by the per-item status (own direct secrets + the active
  // env they inherit). Computed once here so every protocol picks it up.
  const secretBadges = (id: string): ReactNode => React.createElement(ItemSecretBadges, { itemId: id })

  if (isRequest(item)) {
    let base: ListViewItemData
    if (isHTTPRequest(item)) base = httpRequestToListViewItem(item, options)
    else if (isGraphQLRequest(item)) base = graphqlRequestToListViewItem(item, options)
    else if (isGrpcRequest(item)) base = grpcRequestToListViewItem(item, options)
    else if (isSoapRequest(item)) base = soapRequestToListViewItem(item, options)
    else if (isWebSocketRequest(item)) base = websocketRequestToListViewItem(item, options)
    else if (isSseRequest(item)) base = sseRequestToListViewItem(item, options)
    else if (isODataRequest(item)) base = odataRequestToListViewItem(item, options)
    else if (isAuthenticationRequest(item)) base = authenticationRequestToListViewItem(item, options)
    else if (isAmqpRequest(item)) base = amqpRequestToListViewItem(item, options)
    // STOMP / Redis / JSON-RPC / JSON-RPC batch / tRPC / Kafka (and any new
    // protocol) get their tab-accurate badge from the registry-driven fallback
    // instead of a blank icon.
    else base = genericRequestToListViewItem(item, options)
    return { ...base, rightActions: secretBadges(item.id) }
  }

  if (isScenario(item)) {
    return { ...scenarioToListViewItem(item, options), rightActions: secretBadges(item.id) }
  }

  if (isApiDesign(item)) {
    return designToListViewItem(item, options)
  }

  if (isEnvironmentFolder(item)) {
    return environmentFolderToListViewItem(item, options)
  }

  if (isFolder(item)) {
    return folderToListViewItem(item, options)
  }

  // Fallback for unknown types
  return {
    id: (item as { id?: string }).id ?? crypto.randomUUID(),
    title: (item as { name?: string }).name ?? 'Unknown',
    icon: 'blank'
  }
}

/**
 * Convert an EnvironmentFolder to a ListViewItemData
 */
function environmentFolderToListViewItem(
  folder: EnvironmentFolder,
  options: FolderToListViewOptions
): ListViewItemData {
  const isExpanded = options.expandedIds.has(folder.id)

  const children = childItemsOf(folder).map((item) => folderItemToListViewItem(item, options))
  return {
    id: folder.id,
    title: folder.name,
    isExpandable: children.length > 0,
    isExpanded,
    icon: toListViewIcon(folder.icon, 'folder-library'),
    // Spinner (while any env resolves) + error badge (if any env's resolution
    // failed) just after the env-folder name.
    rightActions: React.createElement(
      React.Fragment,
      null,
      React.createElement(SecretResolvingSpinner, { environmentIds: collectFolderEnvIds(folder.environments) }),
      React.createElement(SecretErrorIndicator, { environmentIds: collectFolderEnvIds(folder.environments) })
    ),
    children
  }
}

/**
 * Convert a Folder to a ListViewItemData
 */
function folderToListViewItem(
  folder: Folder,
  options: FolderToListViewOptions
): ListViewItemData {
  const isExpanded = options.expandedIds.has(folder.id)

  const children = childItemsOf(folder).map((item) => folderItemToListViewItem(item, options))
  return {
    id: folder.id,
    title: folder.name,
    isExpandable: children.length > 0,
    isExpanded,
    icon: toListViewIcon(folder.icon, isExpanded ? 'folder-opened' : 'folder'),
    children
  }
}

/**
 * Convert a root Folder or EnvironmentFolder to an array of ListViewItemData
 * Returns the folder's children as top-level items
 */
export function folderToListViewItems(
  folder: Folder | EnvironmentFolder,
  options: FolderToListViewOptions
): ListViewItemData[] {
  return childItemsOf(folder).map((item) => folderItemToListViewItem(item, options))
}

/**
 * Convert a root Folder or EnvironmentFolder to a single ListViewItemData (the folder itself as root)
 */
export function folderAsRootListViewItem(
  folder: Folder | EnvironmentFolder,
  options: FolderToListViewOptions
): ListViewItemData {
  if (isEnvironmentFolder(folder as FolderItem)) {
    return environmentFolderToListViewItem(folder as EnvironmentFolder, options)
  }
  return folderToListViewItem(folder, options)
}

/**
 * Collect all folder IDs from a Folder or EnvironmentFolder tree (for expanding all)
 */
export function collectAllFolderIds(folder: Folder | EnvironmentFolder): string[] {
  const ids: string[] = [folder.id]

  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      ids.push(...collectAllFolderIds(item))
    }
  }

  return ids
}

/**
 * Collect every expandable container id in a tree — folders, env-folders, and
 * scenarios (which behave like folders, holding child items). Seeds the
 * sidebar's persisted expand/collapse set, so a scenario's open/closed state
 * survives a reload exactly like a folder's (a scenario excluded from the
 * known set would have its persisted id filtered out on restore).
 */
/** A folder's children, tolerating the shapes a hand-written or older
 * project file can carry: `items:` with nothing after it parses to `null`,
 * which every `.map`/`.flatMap` below would throw on — and a throw here
 * takes the whole renderer down with it. */
function childItemsOf(item: { items?: FolderItem[] | null }): FolderItem[] {
  return Array.isArray(item.items) ? item.items : []
}

export function collectExpandableIds(item: FolderItem): string[] {
  // A design expands into its virtual group entries — always expandable.
  if (isApiDesign(item)) {
    return [item.id]
  }
  // A scenario is a container too, but it carries `type:'scenario'` and an
  // optional `items` — branch it first (an empty scenario isn't expandable).
  if (isScenario(item)) {
    const children = childItemsOf(item)
    return children.length > 0 ? [item.id, ...children.flatMap(collectExpandableIds)] : []
  }
  // Folders AND env-folders. Test `'items' in item` rather than `isAnyFolder`:
  // the latter requires `configuration`, which env-folders lack, so it would
  // drop a root env-folder and leave it collapsed on load.
  if ('items' in item) {
    return [item.id, ...childItemsOf(item).flatMap(collectExpandableIds)]
  }
  return []
}
