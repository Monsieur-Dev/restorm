/**
 * Context menu builder for sidebar items
 */

import React from 'react'
import type { ListViewItemData } from 'electron-core-ui/renderer'
import { RegistryBadge } from '../../common/RegistryBadge'
import { parseDesignSectionRowId, parseDesignEntityRowId } from '../../../../../shared/design/designSections'

export interface SidebarContextMenuItem {
  id: string
  label: string
  /** Codicon name (string) or any React node — passed straight to
   * `ContextMenuItem.icon`. Strings get wrapped in `codicon-<name>`;
   * nodes render as-is in the icon slot (used for Badge glyphs). */
  icon?: string | React.ReactNode
  shortcut?: string
  isSeparator?: boolean
  /** Greyed-out, non-clickable entry (mirrors the ECUI ContextMenuItem flag). */
  disabled?: boolean
  onClick?: () => void
  /** Nested items for a submenu entry. */
  items?: SidebarContextMenuItem[]
  /** Stable E2E selector — passed straight to the ECUI ContextMenuItem. */
  'data-testid'?: string
}

export type TranslateFunction = (key: string) => string
export type ContextMenuActionHandler = (itemId: string) => void

/** Kinds passed to {@link AddChildHandler}. `http-<method>` creates an
 * HTTP request pre-set to the matching method; `auth` uses the
 * dedicated Authentication type (renders a key badge). */
export type AddChildKind =
  | 'folder'
  | 'http-get'
  | 'http-post'
  | 'http-put'
  | 'http-patch'
  | 'http-delete'
  | 'http-head'
  | 'http-options'
  | 'http-query'
  | 'graphql'
  | 'grpc'
  | 'grpc-server-stream'
  | 'grpc-client-stream'
  | 'grpc-bidi'
  | 'grpc-server'
  | 'soap'
  | 'soap-server'
  | 'websocket'
  | 'socketio'
  | 'socketio-server'
  | 'websocket-server'
  | 'stomp'
  | 'mqtt'
  | 'mqtt-server'
  | 'sse'
  | 'kafka-produce'
  | 'kafka-consume'
  | 'http-server'
  | 'graphql-server'
  | 'odata'
  | 'odata-server'
  | 'amqp'
  | 'redis'
  | 'auth'
  | 'trpc'
  | 'scenario'
  | 'design'

export type AddChildHandler = (parentId: string, kind: AddChildKind) => void

export interface BuildContextMenuOptions {
  item: ListViewItemData
  t: TranslateFunction
  onCloneItem: ContextMenuActionHandler
  onDeleteItem: ContextMenuActionHandler
  onRenameItem: ContextMenuActionHandler
  /** Kind-agnostic "Add child" dispatcher. Invoked from the Ajouter
   * submenu entries for folders and environment folders. */
  onAddChildItem: AddChildHandler
  isItemFavorite?: (itemId: string) => boolean
  onToggleFavorite?: ContextMenuActionHandler
  /** Cut / copy the item to the sidebar clipboard; paste INTO/AFTER it. The
   * handlers take the target id — the shared array-based clipboard lives in
   * the host (multi-selection ready). */
  onCutItem?: ContextMenuActionHandler
  onCopyItem?: ContextMenuActionHandler
  onPasteItem?: ContextMenuActionHandler
  /** Whether a paste payload is staged (greys out Coller otherwise). */
  canPaste?: () => boolean
  /** `true` when the folder identified by id has an importable
   * source attached. Drives the "Refresh from source" entry. */
  canRefreshFromSource?: (itemId: string) => boolean
  onRefreshFromSource?: ContextMenuActionHandler
  /** `true` when the item is a Scenario. Routes the folder-like
   * container through the request-style menu (toggle-favorite +
   * Add submenu) so a user can bookmark / clone / delete a
   * scenario the same way a request gets those entries. */
  isItemScenario?: (itemId: string) => boolean
  /** Flags API-design rows — routed through the design branch (no Add
   * submenu, plus the explicit split-panel escape hatch). */
  isItemDesign?: (itemId: string) => boolean
  /** `true` when the folder carries an imported ApiDocumentation —
   * drives the "Create a design from this API" prefill entry. */
  canCreateDesignFromDoc?: (itemId: string) => boolean
  onCreateDesignFromDoc?: (itemId: string) => void
  /** Open the item in a split workbench panel — the deliberate breach
   * of the design single-tab policy. */
  onOpenInSplit?: (itemId: string) => void
}

/** One request/server entry of the Add menu — a `kind` the `onAddChildItem`
 * dispatcher understands + its declarative registry badge. Shared verbatim by
 * the sidebar Add submenu AND the scenario add-child palette so the two read
 * identically (same order, same labels, same badge ids). */
export interface AddMenuRequestEntry {
  kind: AddChildKind
  /** `badgeRegistry.json` id — the single parity source between both surfaces. */
  badgeId: string
  /** Badge text override (the HTTP verb rides on the shared `http_*` colors). */
  text?: string
  /** Force the SRV capsule (the HTTP mock server keeps its METHOD body color). */
  server?: boolean
  /** i18n key (+ English fallback for the palette's `t(key, default)` form). */
  labelKey: string
  defaultLabel: string
  /** Techno tag inside a multi-technology group (Messaging) — renderers
   * insert a separator whenever it changes between consecutive entries. */
  techno?: string
}

/** A protocol submenu of the Add menu — its header (label + representative
 * badge/codicon) and the request/server entries it nests. */
export interface AddMenuGroup {
  /** Stable id — lets the scenario palette map this group onto its extra
   * per-protocol action entries (send / close / listen …). */
  id: string
  labelKey: string
  defaultLabel: string
  /** Registry badge shown on the submenu header; omit to use `icon` instead. */
  badgeId?: string
  /** Codicon header glyph when no single protocol badge fits (Messaging). */
  icon?: string
  entries: AddMenuRequestEntry[]
}

/** The HTTP block — the eight methods + the mock server — rendered inline (no
 * submenu) right after the folder / scenario / auth entries. */
export const ADD_MENU_HTTP_ENTRIES: AddMenuRequestEntry[] = [
  { kind: 'http-get', badgeId: 'http_get', text: 'GET', labelKey: 'sidebar.contextMenu.add.httpGet', defaultLabel: 'HTTP – GET request' },
  { kind: 'http-post', badgeId: 'http_post', text: 'POST', labelKey: 'sidebar.contextMenu.add.httpPost', defaultLabel: 'HTTP – POST request' },
  { kind: 'http-put', badgeId: 'http_put', text: 'PUT', labelKey: 'sidebar.contextMenu.add.httpPut', defaultLabel: 'HTTP – PUT request' },
  { kind: 'http-patch', badgeId: 'http_patch', text: 'PATCH', labelKey: 'sidebar.contextMenu.add.httpPatch', defaultLabel: 'HTTP – PATCH request' },
  { kind: 'http-delete', badgeId: 'http_delete', text: 'DELETE', labelKey: 'sidebar.contextMenu.add.httpDelete', defaultLabel: 'HTTP – DELETE request' },
  { kind: 'http-head', badgeId: 'http_head', text: 'HEAD', labelKey: 'sidebar.contextMenu.add.httpHead', defaultLabel: 'HTTP – HEAD request' },
  { kind: 'http-options', badgeId: 'http_options', text: 'OPTIONS', labelKey: 'sidebar.contextMenu.add.httpOptions', defaultLabel: 'HTTP – OPTIONS request' },
  { kind: 'http-query', badgeId: 'http_query', text: 'QUERY', labelKey: 'sidebar.contextMenu.add.httpQuery', defaultLabel: 'HTTP – QUERY request' },
  // restorm hosts a local HTTP endpoint (METHOD + PATH) serving a configured
  // response — its body keeps the GET color, so the SRV capsule is forced on.
  { kind: 'http-server', badgeId: 'http_get', server: true, labelKey: 'sidebar.contextMenu.add.httpServer', defaultLabel: 'HTTP server' }
]

/** The protocol submenus, in the canonical Add-menu order. Only kinds that
 * exist as `onAddChildItem` targets appear here — protocols whose "server"
 * variant is not yet a distinct kind (Redis / STOMP / SSE servers) expose only
 * their client entry, and GraphQL subscription is a request *mode*, not a
 * separate creation kind, so neither is invented here. */
export const ADD_MENU_PROTOCOL_GROUPS: AddMenuGroup[] = [
  {
    id: 'grpc', labelKey: 'sidebar.contextMenu.add.groups.grpc', defaultLabel: 'gRPC', badgeId: 'grpc',
    entries: [
      { kind: 'grpc', badgeId: 'grpc_unary', labelKey: 'sidebar.contextMenu.add.grpc', defaultLabel: 'gRPC request' },
      { kind: 'grpc-server-stream', badgeId: 'grpc_sstr', labelKey: 'sidebar.contextMenu.add.grpcServerStream', defaultLabel: 'gRPC server-streaming request' },
      { kind: 'grpc-client-stream', badgeId: 'grpc_cstr', labelKey: 'sidebar.contextMenu.add.grpcClientStream', defaultLabel: 'gRPC client-streaming request' },
      { kind: 'grpc-bidi', badgeId: 'grpc_bidi', labelKey: 'sidebar.contextMenu.add.grpcBidi', defaultLabel: 'gRPC bidirectional request' },
      { kind: 'grpc-server', badgeId: 'grpc_server', labelKey: 'sidebar.contextMenu.add.grpcServer', defaultLabel: 'gRPC server' }
    ]
  },
  {
    id: 'websocket', labelKey: 'sidebar.contextMenu.add.groups.websocket', defaultLabel: 'WebSocket', badgeId: 'ws',
    entries: [
      { kind: 'websocket', badgeId: 'ws', labelKey: 'sidebar.contextMenu.add.websocket', defaultLabel: 'WebSocket request' },
      { kind: 'websocket-server', badgeId: 'ws_server', labelKey: 'sidebar.contextMenu.add.websocketServer', defaultLabel: 'WebSocket server' }
    ]
  },
  {
    id: 'socketio', labelKey: 'sidebar.contextMenu.add.groups.socketio', defaultLabel: 'Socket.IO', badgeId: 'sio',
    entries: [
      { kind: 'socketio', badgeId: 'sio', labelKey: 'sidebar.contextMenu.add.socketio', defaultLabel: 'Socket.IO request' },
      { kind: 'socketio-server', badgeId: 'sio_server', labelKey: 'sidebar.contextMenu.add.socketioServer', defaultLabel: 'Socket.IO server' }
    ]
  },
  {
    id: 'graphql', labelKey: 'sidebar.contextMenu.add.groups.graphql', defaultLabel: 'GraphQL', badgeId: 'gql',
    entries: [
      { kind: 'graphql', badgeId: 'gql_query', labelKey: 'sidebar.contextMenu.add.graphql', defaultLabel: 'GraphQL request' },
      { kind: 'graphql-server', badgeId: 'gql_query_server', labelKey: 'sidebar.contextMenu.add.graphqlServer', defaultLabel: 'GraphQL server' }
    ]
  },
  {
    id: 'redis', labelKey: 'sidebar.contextMenu.add.groups.redis', defaultLabel: 'Redis', badgeId: 'redis',
    entries: [
      { kind: 'redis', badgeId: 'redis', labelKey: 'sidebar.contextMenu.add.redis', defaultLabel: 'Redis request' }
    ]
  },
  {
    id: 'messaging', labelKey: 'sidebar.contextMenu.add.groups.messaging', defaultLabel: 'Messaging',
    // Messaging bundles several technologies: entries are grouped per techno
    // (the renderers insert a separator whenever `techno` changes).
    entries: [
      { kind: 'mqtt', badgeId: 'mqtt', labelKey: 'sidebar.contextMenu.add.mqtt', defaultLabel: 'MQTT request', techno: 'mqtt' },
      { kind: 'mqtt-server', badgeId: 'mqtt_server', labelKey: 'sidebar.contextMenu.add.mqttServer', defaultLabel: 'MQTT server', techno: 'mqtt' },
      { kind: 'amqp', badgeId: 'amqp', labelKey: 'sidebar.contextMenu.add.amqp', defaultLabel: 'AMQP request', techno: 'amqp' },
      { kind: 'kafka-produce', badgeId: 'kafka_produce', labelKey: 'sidebar.contextMenu.add.kafkaProduce', defaultLabel: 'Kafka request – Produce', techno: 'kafka' },
      { kind: 'kafka-consume', badgeId: 'kafka_consume', labelKey: 'sidebar.contextMenu.add.kafkaConsume', defaultLabel: 'Kafka request – Consume', techno: 'kafka' },
      { kind: 'stomp', badgeId: 'stomp', labelKey: 'sidebar.contextMenu.add.stomp', defaultLabel: 'STOMP request', techno: 'stomp' }
    ]
  },
  {
    id: 'soap', labelKey: 'sidebar.contextMenu.add.groups.soap', defaultLabel: 'SOAP', badgeId: 'soap',
    entries: [
      { kind: 'soap', badgeId: 'soap', labelKey: 'sidebar.contextMenu.add.soap', defaultLabel: 'SOAP request' },
      { kind: 'soap-server', badgeId: 'soap_server', labelKey: 'sidebar.contextMenu.add.soapServer', defaultLabel: 'SOAP server' }
    ]
  },
  {
    id: 'odata', labelKey: 'sidebar.contextMenu.add.groups.odata', defaultLabel: 'OData', badgeId: 'odata',
    entries: [
      { kind: 'odata', badgeId: 'odata', labelKey: 'sidebar.contextMenu.add.odata', defaultLabel: 'OData request' },
      { kind: 'odata-server', badgeId: 'odata_server', labelKey: 'sidebar.contextMenu.add.odataServer', defaultLabel: 'OData server' }
    ]
  },
  {
    id: 'sse', labelKey: 'sidebar.contextMenu.add.groups.sse', defaultLabel: 'SSE', badgeId: 'sse',
    entries: [
      { kind: 'sse', badgeId: 'sse', labelKey: 'sidebar.contextMenu.add.sse', defaultLabel: 'SSE request' }
    ]
  },
  {
    id: 'trpc', labelKey: 'sidebar.contextMenu.add.groups.trpc', defaultLabel: 'tRPC', badgeId: 'trpc',
    entries: [
      { kind: 'trpc', badgeId: 'trpc', labelKey: 'sidebar.contextMenu.add.trpc', defaultLabel: 'tRPC request' }
    ]
  }
]

/** Render a shared Add-menu request entry as a sidebar context-menu item. */
const addEntryToMenuItem = (
  entry: AddMenuRequestEntry,
  parentId: string,
  t: TranslateFunction,
  onAddChildItem: AddChildHandler
): SidebarContextMenuItem => ({
  id: `add-${entry.kind}-${parentId}`,
  label: t(entry.labelKey),
  icon: React.createElement(RegistryBadge, {
    badgeId: entry.badgeId,
    ...(entry.text !== undefined && { text: entry.text }),
    ...(entry.server === true && { server: true })
  }),
  onClick: () => { onAddChildItem(parentId, entry.kind) }
})

/** Build the "Ajouter" submenu that folders and environment folders
 * expose. Identical contents for both — the caller decides whether to
 * attach it. Exported so the sidebar's empty-area context menu can
 * reuse the same submenu with `parentId === ''` (root sentinel).
 *
 * Structure: folder / scenario / auth, a separator, the HTTP block
 * (methods + mock server) inline, a separator, then one nested submenu
 * per protocol. */
export const buildAddSubmenu = (
  parentId: string,
  t: TranslateFunction,
  onAddChildItem: AddChildHandler
): SidebarContextMenuItem[] => [
  {
    id: `add-folder-${parentId}`,
    label: t('sidebar.contextMenu.add.folder'),
    icon: 'folder',
    'data-testid': 'sidebar-context-menu-add-folder',
    onClick: () => { onAddChildItem(parentId, 'folder') }
  },
  {
    id: `add-scenario-${parentId}`,
    label: t('sidebar.contextMenu.add.scenario'),
    icon: React.createElement(RegistryBadge, { badgeId: 'scenario' }),
    'data-testid': 'sidebar-context-menu-add-scenario',
    onClick: () => { onAddChildItem(parentId, 'scenario') }
  },
  {
    id: `add-design-${parentId}`,
    label: t('sidebar.contextMenu.add.design'),
    icon: React.createElement(RegistryBadge, { badgeId: 'design' }),
    'data-testid': 'sidebar-context-menu-add-design',
    onClick: () => { onAddChildItem(parentId, 'design') }
  },
  {
    id: `add-auth-${parentId}`,
    label: t('sidebar.contextMenu.add.auth'),
    icon: React.createElement(RegistryBadge, { badgeId: 'auth' }),
    'data-testid': 'sidebar-context-menu-add-auth',
    onClick: () => { onAddChildItem(parentId, 'auth') }
  },
  { id: `sep-add-top-${parentId}`, isSeparator: true, label: '' },
  ...ADD_MENU_HTTP_ENTRIES.map((entry) => addEntryToMenuItem(entry, parentId, t, onAddChildItem)),
  { id: `sep-add-http-${parentId}`, isSeparator: true, label: '' },
  ...ADD_MENU_PROTOCOL_GROUPS.map((group): SidebarContextMenuItem => ({
    id: `add-group-${group.id}-${parentId}`,
    label: t(group.labelKey),
    // Group (submenu) entries carry NO badge — a plain codicon at most.
    icon: group.icon ?? '',
    items: (() => {
      const isServerEntry = (e: AddMenuRequestEntry): boolean => e.server === true || e.badgeId.endsWith('_server')
      // Within each techno block (Messaging) — or the whole group when
      // untagged — client entries first, server entries last. Stable sort
      // keyed on (first-seen techno, server flag) keeps techno blocks intact.
      const technoRank = new Map<string | undefined, number>()
      for (const e of group.entries) if (!technoRank.has(e.techno)) technoRank.set(e.techno, technoRank.size)
      const ordered = [...group.entries].sort((a, b) =>
        ((technoRank.get(a.techno) ?? 0) - (technoRank.get(b.techno) ?? 0)) || (Number(isServerEntry(a)) - Number(isServerEntry(b))))
      return ordered.flatMap((entry, i) => {
        const prev = ordered[i - 1]
        const technoBoundary = prev !== undefined && prev.techno !== entry.techno && (prev.techno !== undefined || entry.techno !== undefined)
        const serverBoundary = prev !== undefined && !isServerEntry(prev) && isServerEntry(entry)
        return [
          ...(technoBoundary || serverBoundary ? [{ id: `sep-${group.id}-${String(i)}-${parentId}`, isSeparator: true as const, label: '' }] : []),
          addEntryToMenuItem(entry, parentId, t, onAddChildItem)
        ]
      })
    })()
  }))
]

/** Build the sidebar's empty-area (collection root) context menu: a single
 * "Add" submenu — the shared {@link buildAddSubmenu} with the root-only
 * "Environment folder" creation slotted in right after "Folder". Every
 * creation entry lives under "Add" (no redundant top-level "Create folder";
 * that action is `Add > Folder`). Environment folders can only be created at
 * the collection root, so their entry is injected here rather than in the
 * shared submenu that per-folder and scenario menus also render. */
export const buildEmptyAreaContextMenu = (
  t: TranslateFunction,
  onAddChildItem: AddChildHandler,
  onCreateEnvironmentFolder: () => void
): SidebarContextMenuItem[] => {
  const addItems = buildAddSubmenu('', t, onAddChildItem)
  const folderIndex = addItems.findIndex((entry) => entry.id.startsWith('add-folder-'))
  // The shared submenu opens with "Folder"; should that ever stop being true,
  // put the environment folder first rather than stranding it at the bottom.
  const insertAt = folderIndex >= 0 ? folderIndex + 1 : 0
  addItems.splice(insertAt, 0, {
    id: 'add-env-folder',
    label: t('sidebar.contextMenu.add.environmentFolder'),
    icon: 'folder-library',
    onClick: () => { onCreateEnvironmentFolder() }
  })
  return [
    {
      id: 'add-root-child',
      label: t('sidebar.contextMenu.add.title'),
      icon: 'add',
      'data-testid': 'sidebar-context-menu-add-root-child',
      items: addItems
    }
  ]
}

/** Handlers for the GROUP context menu shown when the right-clicked row
 * belongs to a multi-selection — every action receives the whole id list. */
export interface SelectionContextMenuHandlers {
  onCutItems: (ids: string[]) => void
  onCopyItems: (ids: string[]) => void
  onCloneItems: (ids: string[]) => void
  onDeleteItems: (ids: string[]) => void
  onToggleFavoriteItems: (ids: string[]) => void
}

/** Context menu for a MULTI-selection: only the actions that make sense on
 * a heterogeneous group — cut / copy / clone / favorites / delete. The
 * per-item entries (rename, add-child, paste-at, refresh) stay on the
 * single-item menu: they each need exactly one target. */
export const buildSelectionContextMenu = (
  ids: string[],
  t: TranslateFunction,
  handlers: SelectionContextMenuHandlers,
  /** True when EVERY selected item is already a favorite — the entry then
   * offers removal; otherwise it offers adding the whole group. */
  allFavorite: boolean
): SidebarContextMenuItem[] => [
  {
    id: 'toggle-favorite',
    label: allFavorite ? t('sidebar.contextMenu.removeFromFavorites') : t('sidebar.contextMenu.addToFavorites'),
    icon: allFavorite ? 'star-full' : 'star-empty',
    onClick: () => { handlers.onToggleFavoriteItems(ids) }
  },
  { id: 'sep-fav', isSeparator: true, label: '' },
  { id: 'cut-item', label: t('sidebar.contextMenu.cut'), icon: 'file-symlink-file', onClick: () => { handlers.onCutItems(ids) } },
  { id: 'copy-item', label: t('sidebar.contextMenu.copy'), icon: 'files', onClick: () => { handlers.onCopyItems(ids) } },
  {
    id: 'clone-item',
    label: t('sidebar.contextMenu.clone'),
    icon: 'copy',
    onClick: () => { handlers.onCloneItems(ids) }
  },
  { id: 'sep-item', isSeparator: true, label: '' },
  {
    id: 'delete-item',
    label: t('sidebar.contextMenu.delete'),
    icon: 'trash',
    onClick: () => { handlers.onDeleteItems(ids) }
  }
]

/** The Couper / Copier / Coller trio, shared by every item branch. Paste is
 * greyed out until a copy is staged. */
const clipboardEntries = (
  itemId: string,
  t: TranslateFunction,
  onCutItem?: ContextMenuActionHandler,
  onCopyItem?: ContextMenuActionHandler,
  onPasteItem?: ContextMenuActionHandler,
  canPaste?: () => boolean
): SidebarContextMenuItem[] => {
  if (!onCutItem && !onCopyItem && !onPasteItem) return []
  return [
    ...(onCutItem ? [{ id: 'cut-item', label: t('sidebar.contextMenu.cut'), icon: 'file-symlink-file', onClick: () => { onCutItem(itemId) } }] : []),
    ...(onCopyItem ? [{ id: 'copy-item', label: t('sidebar.contextMenu.copy'), icon: 'files', onClick: () => { onCopyItem(itemId) } }] : []),
    ...(onPasteItem ? [{ id: 'paste-item', label: t('sidebar.contextMenu.paste'), icon: 'output', ...(canPaste?.() === false ? { disabled: true } : {}), onClick: () => { onPasteItem(itemId) } }] : []),
    { id: 'sep-clipboard', isSeparator: true, label: '' }
  ]
}

export const buildContextMenuForItem = (
  options: BuildContextMenuOptions
): SidebarContextMenuItem[] => {
  const { item, t, onCloneItem, onDeleteItem, onRenameItem, onAddChildItem, isItemFavorite, onToggleFavorite, onCutItem, onCopyItem, onPasteItem, canPaste, canRefreshFromSource, onRefreshFromSource, isItemScenario, isItemDesign, onOpenInSplit, canCreateDesignFromDoc, onCreateDesignFromDoc } = options
  const itemId = item.id

  // A design's virtual section rows carry no menu of their own: every
  // action (favourite, clone, delete…) belongs to the design node.
  if (parseDesignSectionRowId(itemId) !== null) {
    return []
  }

  // A design's model/enum/route(-group) node carries its OWN menu, attached on
  // the ListViewItemData in `designSidebarNodes`. Returning [] here keeps
  // `attachContextMenus` from clobbering it with the generic item menu.
  if (parseDesignEntityRowId(itemId) !== null) {
    return []
  }

  if (isItemDesign?.(itemId) === true) {
    const isFav = isItemFavorite?.(itemId) ?? false
    return [
      {
        id: 'toggle-favorite',
        label: isFav ? t('sidebar.contextMenu.removeFromFavorites') : t('sidebar.contextMenu.addToFavorites'),
        icon: isFav ? 'star-full' : 'star-empty',
        onClick: () => { onToggleFavorite?.(itemId) }
      },
      { id: 'sep-fav', isSeparator: true, label: '' },
      ...(onOpenInSplit !== undefined ? [{
        id: 'open-in-split',
        label: t('sidebar.contextMenu.openInSplit'),
        icon: 'split-horizontal',
        onClick: () => { onOpenInSplit(itemId) }
      }, { id: 'sep-split', isSeparator: true, label: '' }] : []),
      ...clipboardEntries(itemId, t, onCutItem, onCopyItem, onPasteItem, canPaste),
      {
        id: 'clone-item',
        label: t('sidebar.contextMenu.clone'),
        icon: 'copy',
        shortcut: 'Ctrl+D',
        onClick: () => { onCloneItem(itemId) }
      },
      {
        id: 'rename-item',
        label: t('sidebar.contextMenu.rename'),
        icon: 'edit',
        shortcut: 'F2',
        onClick: () => { onRenameItem(itemId) }
      },
      { id: 'sep-item', isSeparator: true, label: '' },
      {
        id: 'delete-item',
        label: t('sidebar.contextMenu.delete'),
        icon: 'trash',
        shortcut: 'Suppr',
        onClick: () => { onDeleteItem(itemId) }
      }
    ]
  }
  // Scenarios are folder-shaped (they carry `children`) but the user
  // wants the same favourite / add-child / clone affordances they get
  // on a request — surface them via a dedicated branch above the
  // generic folder one.
  const isScenarioItem = isItemScenario?.(itemId) === true
  const isItemFolder = Array.isArray(item.children) && !isScenarioItem

  if (isScenarioItem) {
    const isFav = isItemFavorite?.(itemId) ?? false
    return [
      {
        id: 'toggle-favorite',
        label: isFav ? t('sidebar.contextMenu.removeFromFavorites') : t('sidebar.contextMenu.addToFavorites'),
        icon: isFav ? 'star-full' : 'star-empty',
        onClick: () => { onToggleFavorite?.(itemId) }
      },
      { id: 'sep-fav', isSeparator: true, label: '' },
      {
        id: 'add-child',
        label: t('sidebar.contextMenu.add.title'),
        icon: 'add',
        items: buildAddSubmenu(itemId, t, onAddChildItem)
      },
      { id: 'sep-add', isSeparator: true, label: '' },
      ...clipboardEntries(itemId, t, onCutItem, onCopyItem, onPasteItem, canPaste),
      {
        id: 'clone-item',
        label: t('sidebar.contextMenu.clone'),
        icon: 'copy',
        shortcut: 'Ctrl+D',
        onClick: () => { onCloneItem(itemId) }
      },
      {
        id: 'rename-item',
        label: t('sidebar.contextMenu.rename'),
        icon: 'edit',
        shortcut: 'F2',
        onClick: () => { onRenameItem(itemId) }
      },
      { id: 'sep-item', isSeparator: true, label: '' },
      {
        id: 'delete-item',
        label: t('sidebar.contextMenu.delete'),
        icon: 'trash',
        shortcut: 'Suppr',
        onClick: () => { onDeleteItem(itemId) }
      }
    ]
  }

  if (isItemFolder) {
    const showRefresh = canRefreshFromSource?.(itemId) === true && onRefreshFromSource
    const refreshEntry: SidebarContextMenuItem[] = showRefresh
      ? [
        { id: 'sep-refresh', isSeparator: true, label: '' },
        {
          id: 'refresh-from-source',
          label: t('common.refresh'),
          icon: 'cloud-download',
          onClick: () => { onRefreshFromSource(itemId) }
        }
      ]
      : []
    const designFromDocEntry: SidebarContextMenuItem[] = (canCreateDesignFromDoc?.(itemId) === true && onCreateDesignFromDoc)
      ? [{
        id: 'create-design-from-doc',
        label: t('design.createFromDoc'),
        icon: 'symbol-color',
        onClick: () => { onCreateDesignFromDoc(itemId) }
      }]
      : []
    return [
      {
        id: 'add-child',
        label: t('sidebar.contextMenu.add.title'),
        icon: 'add',
        items: buildAddSubmenu(itemId, t, onAddChildItem)
      },
      { id: 'sep-add', isSeparator: true, label: '' },
      ...clipboardEntries(itemId, t, onCutItem, onCopyItem, onPasteItem, canPaste),
      {
        id: 'clone-item',
        label: t('sidebar.contextMenu.clone'),
        icon: 'copy',
        shortcut: 'Ctrl+D',
        onClick: () => { onCloneItem(itemId) }
      },
      {
        id: 'rename-item',
        label: t('sidebar.contextMenu.rename'),
        icon: 'edit',
        shortcut: 'F2',
        onClick: () => {
          onRenameItem(itemId)
        }
      },
      ...refreshEntry,
      ...designFromDocEntry,
      { id: 'sep-folder', isSeparator: true, label: '' },
      {
        id: 'delete-folder',
        label: t('sidebar.contextMenu.delete'),
        icon: 'trash',
        shortcut: 'Suppr',
        onClick: () => {
          onDeleteItem(itemId)
        }
      }
    ]
  }

  const isFav = isItemFavorite?.(itemId) ?? false

  return [
    {
      id: 'toggle-favorite',
      label: isFav ? t('sidebar.contextMenu.removeFromFavorites') : t('sidebar.contextMenu.addToFavorites'),
      icon: isFav ? 'star-full' : 'star-empty',
      onClick: () => { onToggleFavorite?.(itemId) }
    },
    { id: 'sep-fav', isSeparator: true, label: '' },
    ...clipboardEntries(itemId, t, onCutItem, onCopyItem, onPasteItem, canPaste),
    {
      id: 'clone-item',
      label: t('sidebar.contextMenu.clone'),
      icon: 'copy',
      shortcut: 'Ctrl+D',
      onClick: () => {
        onCloneItem(itemId)
      }
    },
    {
      id: 'rename-item',
      label: t('sidebar.contextMenu.rename'),
      icon: 'edit',
      shortcut: 'F2',
      onClick: () => { onRenameItem(itemId) }
    },
    { id: 'sep-item', isSeparator: true, label: '' },
    {
      id: 'delete-item',
      label: t('sidebar.contextMenu.delete'),
      icon: 'trash',
      shortcut: 'Suppr',
      onClick: () => {
        onDeleteItem(itemId)
      }
    }
  ]
}

export interface BuildFavoritesContextMenuOptions {
  item: ListViewItemData
  t: TranslateFunction
  onCloneItem: ContextMenuActionHandler
  onDeleteItem: ContextMenuActionHandler
  onRenameItem: ContextMenuActionHandler
  onUnfavorite: ContextMenuActionHandler
}

export const buildFavoritesContextMenuForItem = (
  options: BuildFavoritesContextMenuOptions
): SidebarContextMenuItem[] => {
  const { item, t, onCloneItem, onDeleteItem, onRenameItem, onUnfavorite } = options
  const itemId = item.id
  return [
    {
      id: 'rename-item',
      label: t('sidebar.contextMenu.rename'),
      icon: 'edit',
      shortcut: 'F2',
      onClick: () => { onRenameItem(itemId) }
    },
    {
      id: 'clone-item',
      label: t('sidebar.contextMenu.clone'),
      icon: 'copy',
      shortcut: 'Ctrl+D',
      onClick: () => { onCloneItem(itemId) }
    },
    {
      id: 'delete-item',
      label: t('sidebar.contextMenu.delete'),
      icon: 'trash',
      shortcut: 'Suppr',
      onClick: () => { onDeleteItem(itemId) }
    },
    { id: 'sep-fav', isSeparator: true, label: '' },
    {
      id: 'remove-from-favorites',
      label: t('sidebar.contextMenu.removeFromFavorites'),
      icon: 'star-empty',
      onClick: () => { onUnfavorite(itemId) }
    }
  ]
}

export interface BuildOpenDocumentsContextMenuOptions {
  item: ListViewItemData
  t: TranslateFunction
  onCloneItem: ContextMenuActionHandler
  onDeleteItem: ContextMenuActionHandler
  onRenameItem: ContextMenuActionHandler
  isItemFavorite: (itemId: string) => boolean
  onToggleFavorite: ContextMenuActionHandler
  onCloseTab: ContextMenuActionHandler
  onCloseOtherTabs: ContextMenuActionHandler
  onCloseTabsToTheRight: ContextMenuActionHandler
  onCloseAllTabs: () => void
}

export const buildOpenDocumentsContextMenuForItem = (
  options: BuildOpenDocumentsContextMenuOptions
): SidebarContextMenuItem[] => {
  const {
    item, t,
    onCloneItem, onDeleteItem, onRenameItem,
    isItemFavorite, onToggleFavorite,
    onCloseTab, onCloseOtherTabs, onCloseTabsToTheRight, onCloseAllTabs
  } = options
  const itemId = item.id
  const isFav = isItemFavorite(itemId)
  return [
    {
      id: 'rename-item',
      label: t('sidebar.contextMenu.rename'),
      icon: 'edit',
      shortcut: 'F2',
      onClick: () => { onRenameItem(itemId) }
    },
    {
      id: 'clone-item',
      label: t('sidebar.contextMenu.clone'),
      icon: 'copy',
      shortcut: 'Ctrl+D',
      onClick: () => { onCloneItem(itemId) }
    },
    {
      id: 'delete-item',
      label: t('sidebar.contextMenu.delete'),
      icon: 'trash',
      shortcut: 'Suppr',
      onClick: () => { onDeleteItem(itemId) }
    },
    { id: 'sep-fav', isSeparator: true, label: '' },
    {
      id: 'toggle-favorite',
      label: isFav
        ? t('sidebar.contextMenu.removeFromFavorites')
        : t('sidebar.contextMenu.addToFavorites'),
      icon: isFav ? 'star-full' : 'star-empty',
      onClick: () => { onToggleFavorite(itemId) }
    },
    {
      // Clicking the parent closes just this tab; the submenu still
      // opens on hover for the other three close actions.
      id: 'close-submenu',
      label: t('sidebar.contextMenu.closeTab'),
      icon: 'close',
      onClick: () => { onCloseTab(itemId) },
      items: [
        {
          id: 'close-other-tabs',
          label: t('sidebar.contextMenu.closeOtherTabs'),
          icon: 'close-all',
          onClick: () => { onCloseOtherTabs(itemId) }
        },
        {
          id: 'close-tabs-to-the-right',
          label: t('sidebar.contextMenu.closeTabsToTheRight'),
          icon: 'chevron-right',
          onClick: () => { onCloseTabsToTheRight(itemId) }
        },
        {
          id: 'close-all-tabs',
          label: t('sidebar.contextMenu.closeAllTabs'),
          icon: 'close-all',
          onClick: onCloseAllTabs
        }
      ]
    }
  ]
}

export interface AttachContextMenusOptions {
  items: ListViewItemData[]
  t: TranslateFunction
  onCloneItem: ContextMenuActionHandler
  onDeleteItem: ContextMenuActionHandler
  onRenameItem: ContextMenuActionHandler
  onAddChildItem: AddChildHandler
  isItemFavorite?: (itemId: string) => boolean
  onToggleFavorite?: ContextMenuActionHandler
  onCutItem?: ContextMenuActionHandler
  onCopyItem?: ContextMenuActionHandler
  onPasteItem?: ContextMenuActionHandler
  canPaste?: () => boolean
  canRefreshFromSource?: (itemId: string) => boolean
  onRefreshFromSource?: ContextMenuActionHandler
  isItemScenario?: (itemId: string) => boolean
  /** Flags API-design rows — routed through the design branch (no Add
   * submenu, plus the explicit split-panel escape hatch). */
  isItemDesign?: (itemId: string) => boolean
  /** `true` when the folder carries an imported ApiDocumentation —
   * drives the "Create a design from this API" prefill entry. */
  canCreateDesignFromDoc?: (itemId: string) => boolean
  onCreateDesignFromDoc?: (itemId: string) => void
  /** Open the item in a split workbench panel — the deliberate breach
   * of the design single-tab policy. */
  onOpenInSplit?: (itemId: string) => void
}

export const attachContextMenus = (
  options: AttachContextMenusOptions
): ListViewItemData[] =>
  options.items.map((item) => {
    const menu = buildContextMenuForItem({ ...options, item })
    const withMenu = {
      ...item,
      // An empty menu means "no context menu at all" (a design's virtual
      // section rows) — omit the key so the ListView opens nothing.
      ...(menu.length > 0 ? { contextMenuItems: menu } : {})
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus({ ...options, items: item.children })
    }
    return withMenu
  })
