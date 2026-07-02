/**
 * Context menu builder for sidebar items
 */

import React from 'react'
import type { ListViewItemData } from 'electron-core-ui/renderer'
import { Badge } from '../../common/Badge'

export interface SidebarContextMenuItem {
  id: string
  label: string
  /** Codicon name (string) or any React node — passed straight to
   * `ContextMenuItem.icon`. Strings get wrapped in `codicon-<name>`;
   * nodes render as-is in the icon slot (used for Badge glyphs). */
  icon?: string | React.ReactNode
  shortcut?: string
  isSeparator?: boolean
  onClick?: () => void
  /** Nested items for a submenu entry. */
  items?: SidebarContextMenuItem[]
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
  /** `true` when the folder identified by id has an importable
   * source attached. Drives the "Refresh from source" entry. */
  canRefreshFromSource?: (itemId: string) => boolean
  onRefreshFromSource?: ContextMenuActionHandler
  /** `true` when the item is a Scenario. Routes the folder-like
   * container through the request-style menu (toggle-favorite +
   * Add submenu) so a user can bookmark / clone / delete a
   * scenario the same way a request gets those entries. */
  isItemScenario?: (itemId: string) => boolean
}

/** Build the "Ajouter" submenu that folders and environment folders
 * expose. Identical contents for both — the caller decides whether to
 * attach it. Exported so the sidebar's empty-area context menu can
 * reuse the same submenu with `parentId === ''` (root sentinel). */
export const buildAddSubmenu = (
  parentId: string,
  t: TranslateFunction,
  onAddChildItem: AddChildHandler
): SidebarContextMenuItem[] => [
  {
    id: `add-folder-${parentId}`,
    label: t('sidebar.contextMenu.add.folder'),
    icon: 'folder',
    onClick: () => { onAddChildItem(parentId, 'folder') }
  },
  { id: `sep-add-folder-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-http-get-${parentId}`,
    label: t('sidebar.contextMenu.add.httpGet'),
    icon: React.createElement(Badge, { type: 'GET' }),
    onClick: () => { onAddChildItem(parentId, 'http-get') }
  },
  {
    id: `add-http-post-${parentId}`,
    label: t('sidebar.contextMenu.add.httpPost'),
    icon: React.createElement(Badge, { type: 'POST' }),
    onClick: () => { onAddChildItem(parentId, 'http-post') }
  },
  {
    id: `add-http-put-${parentId}`,
    label: t('sidebar.contextMenu.add.httpPut'),
    icon: React.createElement(Badge, { type: 'PUT' }),
    onClick: () => { onAddChildItem(parentId, 'http-put') }
  },
  {
    id: `add-http-patch-${parentId}`,
    label: t('sidebar.contextMenu.add.httpPatch'),
    icon: React.createElement(Badge, { type: 'PATCH' }),
    onClick: () => { onAddChildItem(parentId, 'http-patch') }
  },
  {
    id: `add-http-delete-${parentId}`,
    label: t('sidebar.contextMenu.add.httpDelete'),
    icon: React.createElement(Badge, { type: 'DELETE' }),
    onClick: () => { onAddChildItem(parentId, 'http-delete') }
  },
  // HTTP mock server: restorm hosts a local HTTP endpoint (METHOD + PATH) that
  // serves a configured response — grouped with the HTTP methods it answers for.
  {
    id: `add-http-server-${parentId}`,
    label: t('sidebar.contextMenu.add.httpServer'),
    icon: React.createElement(Badge, { type: 'GET', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'http-server') }
  },
  { id: `sep-add-http-${parentId}`, isSeparator: true, label: '' },
  // gRPC — its own group (the four call types) right after HTTP.
  {
    id: `add-grpc-${parentId}`,
    label: t('sidebar.contextMenu.add.grpc'),
    icon: React.createElement(Badge, { type: 'UNARY' }),
    onClick: () => { onAddChildItem(parentId, 'grpc') }
  },
  {
    id: `add-grpc-server-stream-${parentId}`,
    label: t('sidebar.contextMenu.add.grpcServerStream'),
    icon: React.createElement(Badge, { type: 'S-STR' }),
    onClick: () => { onAddChildItem(parentId, 'grpc-server-stream') }
  },
  {
    id: `add-grpc-client-stream-${parentId}`,
    label: t('sidebar.contextMenu.add.grpcClientStream'),
    icon: React.createElement(Badge, { type: 'C-STR' }),
    onClick: () => { onAddChildItem(parentId, 'grpc-client-stream') }
  },
  {
    id: `add-grpc-bidi-${parentId}`,
    label: t('sidebar.contextMenu.add.grpcBidi'),
    icon: React.createElement(Badge, { type: 'BIDI' }),
    onClick: () => { onAddChildItem(parentId, 'grpc-bidi') }
  },
  // gRPC mock server: restorm HOSTS a local gRPC endpoint (its proto + per-method
  // mock responses) on a port — the SRV capsule variant of the gRPC badge.
  {
    id: `add-grpc-server-${parentId}`,
    label: t('sidebar.contextMenu.add.grpcServer'),
    icon: React.createElement(Badge, { type: 'GRPC', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'grpc-server') }
  },
  { id: `sep-add-grpc-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-graphql-${parentId}`,
    label: t('sidebar.contextMenu.add.graphql'),
    icon: React.createElement(Badge, { type: 'QUERY' }),
    onClick: () => { onAddChildItem(parentId, 'graphql') }
  },
  // GraphQL mock server: restorm hosts a local GraphQL endpoint that resolves
  // operations from a configured schema — grouped with the GraphQL client.
  {
    id: `add-graphql-server-${parentId}`,
    label: t('sidebar.contextMenu.add.graphqlServer'),
    icon: React.createElement(Badge, { type: 'QUERY', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'graphql-server') }
  },
  {
    id: `add-soap-${parentId}`,
    label: t('sidebar.contextMenu.add.soap'),
    icon: React.createElement(Badge, { type: 'SOAP' }),
    onClick: () => { onAddChildItem(parentId, 'soap') }
  },
  // SOAP mock server: restorm hosts a local SOAP endpoint that answers configured
  // operations with canned XML envelopes (incl. <soap:Fault>) — grouped with SOAP.
  {
    id: `add-soap-server-${parentId}`,
    label: t('sidebar.contextMenu.add.soapServer'),
    icon: React.createElement(Badge, { type: 'SOAP', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'soap-server') }
  },
  { id: `sep-add-ws-${parentId}`, isSeparator: true, label: '' },
  // WebSocket group: client + server together.
  {
    id: `add-websocket-${parentId}`,
    label: t('sidebar.contextMenu.add.websocket'),
    icon: React.createElement(Badge, { type: 'WS' }),
    onClick: () => { onAddChildItem(parentId, 'websocket') }
  },
  {
    id: `add-websocket-server-${parentId}`,
    label: t('sidebar.contextMenu.add.websocketServer'),
    icon: React.createElement(Badge, { type: 'WS', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'websocket-server') }
  },
  { id: `sep-add-sio-${parentId}`, isSeparator: true, label: '' },
  // Socket.IO group: client + server together.
  {
    id: `add-socketio-${parentId}`,
    label: t('sidebar.contextMenu.add.socketio'),
    icon: React.createElement(Badge, { type: 'SIO' }),
    onClick: () => { onAddChildItem(parentId, 'socketio') }
  },
  {
    id: `add-socketio-server-${parentId}`,
    label: t('sidebar.contextMenu.add.socketioServer'),
    icon: React.createElement(Badge, { type: 'SIO', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'socketio-server') }
  },
  { id: `sep-add-stomp-${parentId}`, isSeparator: true, label: '' },
  // STOMP: client only — connects to an external broker (e.g. ActiveMQ), no
  // restorm-hosted server mode.
  {
    id: `add-stomp-${parentId}`,
    label: t('sidebar.contextMenu.add.stomp'),
    icon: React.createElement(Badge, { type: 'STOMP' }),
    onClick: () => { onAddChildItem(parentId, 'stomp') }
  },
  { id: `sep-add-mqtt-${parentId}`, isSeparator: true, label: '' },
  // MQTT group: client (connects to a broker) + server (restorm hosts a broker).
  {
    id: `add-mqtt-${parentId}`,
    label: t('sidebar.contextMenu.add.mqtt'),
    icon: React.createElement(Badge, { type: 'MQTT' }),
    onClick: () => { onAddChildItem(parentId, 'mqtt') }
  },
  {
    id: `add-mqtt-server-${parentId}`,
    label: t('sidebar.contextMenu.add.mqttServer'),
    icon: React.createElement(Badge, { type: 'MQTT', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'mqtt-server') }
  },
  { id: `sep-add-sse-${parentId}`, isSeparator: true, label: '' },
  // SSE: receive-only streaming, no server mode — a single client entry.
  {
    id: `add-sse-${parentId}`,
    label: t('sidebar.contextMenu.add.sse'),
    icon: React.createElement(Badge, { type: 'SSE' }),
    onClick: () => { onAddChildItem(parentId, 'sse') }
  { id: `sep-add-kafka-${parentId}`, isSeparator: true, label: '' },
  // Kafka group: no server variant (restorm never hosts a broker) — produce
  // (one-shot) + consume (long-lived consumer group) instead.
  {
    id: `add-kafka-produce-${parentId}`,
    label: t('sidebar.contextMenu.add.kafkaProduce'),
    icon: React.createElement(Badge, { type: 'KAFKA', icon: 'arrow-up' }),
    onClick: () => { onAddChildItem(parentId, 'kafka-produce') }
  },
  {
    id: `add-kafka-consume-${parentId}`,
    label: t('sidebar.contextMenu.add.kafkaConsume'),
    icon: React.createElement(Badge, { type: 'KAFKA', icon: 'plug' }),
    onClick: () => { onAddChildItem(parentId, 'kafka-consume') }
  },
  { id: `sep-add-odata-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-odata-${parentId}`,
    label: t('sidebar.contextMenu.add.odata'),
    icon: React.createElement(Badge, { type: 'ODATA' }),
    onClick: () => { onAddChildItem(parentId, 'odata') }
  },
  {
    id: `add-odata-server-${parentId}`,
    label: t('sidebar.contextMenu.add.odataServer'),
    icon: React.createElement(Badge, { type: 'ODATA', mode: 'server' }),
    onClick: () => { onAddChildItem(parentId, 'odata-server') }
  },
  { id: `sep-add-trpc-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-trpc-${parentId}`,
    label: t('sidebar.contextMenu.add.trpc'),
    icon: React.createElement(Badge, { type: 'tRPC' }),
    onClick: () => { onAddChildItem(parentId, 'trpc') }
  },
  { id: `sep-add-amqp-${parentId}`, isSeparator: true, label: '' },
  // AMQP (RabbitMQ): one request type covers publish / subscribe / browse
  // (picked via a mode selector inside the tab), so a single menu entry
  // suffices — unlike WS/MQTT there's no separate client/server pair.
  {
    id: `add-amqp-${parentId}`,
    label: t('sidebar.contextMenu.add.amqp'),
    icon: React.createElement(Badge, { type: 'AMQP' }),
    onClick: () => { onAddChildItem(parentId, 'amqp') }
  },
  { id: `sep-add-redis-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-redis-${parentId}`,
    label: t('sidebar.contextMenu.add.redis'),
    icon: React.createElement(Badge, { type: 'REDIS' }),
    onClick: () => { onAddChildItem(parentId, 'redis') }
  },
  { id: `sep-add-proto-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-auth-${parentId}`,
    label: t('sidebar.contextMenu.add.auth'),
    icon: React.createElement(Badge, { type: 'AUTH' }),
    onClick: () => { onAddChildItem(parentId, 'auth') }
  },
  { id: `sep-add-scenario-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-scenario-${parentId}`,
    label: t('sidebar.contextMenu.add.scenario'),
    icon: React.createElement(Badge, { type: 'SCENARIO' }),
    onClick: () => { onAddChildItem(parentId, 'scenario') }
  }
]

export const buildContextMenuForItem = (
  options: BuildContextMenuOptions
): SidebarContextMenuItem[] => {
  const { item, t, onCloneItem, onDeleteItem, onRenameItem, onAddChildItem, isItemFavorite, onToggleFavorite, canRefreshFromSource, onRefreshFromSource, isItemScenario } = options
  const itemId = item.id
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
    return [
      {
        id: 'add-child',
        label: t('sidebar.contextMenu.add.title'),
        icon: 'add',
        items: buildAddSubmenu(itemId, t, onAddChildItem)
      },
      { id: 'sep-add', isSeparator: true, label: '' },
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
      shortcut: 'F2'
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
  canRefreshFromSource?: (itemId: string) => boolean
  onRefreshFromSource?: ContextMenuActionHandler
  isItemScenario?: (itemId: string) => boolean
}

export const attachContextMenus = (
  options: AttachContextMenusOptions
): ListViewItemData[] =>
  options.items.map((item) => {
    const withMenu = {
      ...item,
      contextMenuItems: buildContextMenuForItem({ ...options, item })
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus({ ...options, items: item.children })
    }
    return withMenu
  })
