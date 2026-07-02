/**
 * Hook for managing item operations (CRUD) in the sidebar
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewDropEventPayload, ListViewItemEventPayload } from 'electron-core-ui/renderer'
import { isTabGroupNode, isContainerNode } from 'electron-core-ui/renderer'
import type { Environment, Folder, EnvironmentFolder, Request, FolderItem } from '../../../shared/types/collections'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import { isAnyFolder, isScenario, isEnvironmentFolder, isFolder, isRequest } from '../../../shared/types/collections'
import {
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest,
  SseRequest,
  ODataRequest,
  AuthenticationRequest,
  TrpcRequest
} from '../../../shared/models/requests'
import type { HTTPMethod } from '../../../shared/models/types'
import { findItemById, findItemWithBreadcrumbs, getFolderIcon, getNearestEnvironmentsForBreadcrumbs } from '../utils/treeSearch'
import { cloneForEventBus } from '../utils/cloneForEventBus'
import { generateUniqueId, cloneItemInTree, removeItemFromTree, insertItemIntoTree } from '../utils/treeManipulation'
import { mapAllWorkbenchTabs, tabReferencesItem } from '../utils/workbenchTabs'
import type { WorkbenchTree, EditorTab } from 'electron-core-ui/renderer'
import type { BreadcrumbItem, FolderTab, EnvironmentFolderTab, HTTPRequestTab, ScenarioEditorTab } from '../../../shared/types/editor'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
import { DocumentEvents, type DocumentChangedPayload } from '../services/DocumentEvents'
import { eventBus } from 'electron-core-ui/renderer'
import type { AddChildKind } from '../components/MainView/Sidebar/contextMenuBuilder'
import { removeFavorite as favoritesStoreRemove } from '../services/favoritesStore'

/** Starter `.proto` a freshly-created gRPC mock server is seeded with: one
 * service with a unary method, so the new server is runnable + self-connectable
 * the moment it is created (the user can replace it with their own proto). */
const GRPC_MOCK_STARTER_PROTO = `syntax = "proto3";
package mock;

message UnaryRequest { string name = 1; }
message UnaryReply { string message = 1; }

service MockService {
  rpc Unary (UnaryRequest) returns (UnaryReply);
}
`

/** A minimal OData v4 CSDL ($metadata) a freshly-created mock serves, so the
 * service is runnable + browsable the moment it is created. One `Pets` entity
 * set keyed by `Id`, with a `Status` + a `Category` navigation property. */
const ODATA_MOCK_STARTER_METADATA = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Restorm.Mock" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Pet">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
        <Property Name="Status" Type="Edm.String"/>
        <Property Name="CategoryId" Type="Edm.Int32"/>
        <NavigationProperty Name="Category" Type="Restorm.Mock.Category"/>
      </EntityType>
      <EntityType Name="Category">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Pets" EntityType="Restorm.Mock.Pet"/>
        <EntitySet Name="Categories" EntityType="Restorm.Mock.Category"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`

/** Starter entity data the mock serves for the {@link ODATA_MOCK_STARTER_METADATA}
 * schema — two pets + their categories, so $filter/$select/$expand all return
 * something the moment the server is created. */
const ODATA_MOCK_STARTER_DATA: Record<string, Record<string, unknown>[]> = {
  Pets: [
    { Id: 1, Name: 'Rex', Status: 'Available', CategoryId: 1 },
    { Id: 2, Name: 'Whiskers', Status: 'Pending', CategoryId: 2 }
  ],
  Categories: [
    { Id: 1, Name: 'Dogs' },
    { Id: 2, Name: 'Cats' }
  ]
}

export interface UseItemOperationsOptions {
  rootItems: FolderItem[]
  setRootItems: React.Dispatch<React.SetStateAction<FolderItem[]>>
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>
  setSidebarEditingItemId: React.Dispatch<React.SetStateAction<string | null>>
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
  setDeleteConfirmation: React.Dispatch<React.SetStateAction<{
    isOpen: boolean
    itemId: string
    itemName: string
    isFolder: boolean
  }>>
  openFolderTab: (folder: Folder, breadcrumbs: import('../../../shared/types/editor').BreadcrumbItem[]) => void
  openScenarioEditorTab: (scenario: import('../../../shared/types/collections').Scenario, breadcrumbs: BreadcrumbItem[]) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: import('../../../shared/types/editor').BreadcrumbItem[]) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => void
  /** Project UUID. When the deleted subtree contains favorited items,
   * each id is removed from the favorites store under this key. */
  projectUuid: string | null
}

export interface UseItemOperationsReturn {
  handleItemDrop: (payload: ListViewDropEventPayload) => void
  handleCloneItem: (itemId: string) => void
  handleCreateRootFolder: () => void
  handleCreateRootEnvironmentFolder: () => void
  /** Kind-agnostic add-child dispatcher bound to the sidebar's
   * "Ajouter" submenu. Creates a well-typed empty request (or a
   * folder), wraps it reactive, pushes it into the parent's `items[]`,
   * fires the matching `*_CREATED` event so the save-unit registry
   * picks it up, and opens the new item in a workbench tab. */
  handleAddChildItem: (parentId: string, kind: AddChildKind, options?: { silent?: boolean }) => string | null
  handleDeleteItem: (itemId: string) => void
  confirmDelete: (itemId: string) => void
  cancelDelete: () => void
  handleSidebarItemRename: (payload: ListViewItemEventPayload, newName: string) => void
}

export function useItemOperations(options: UseItemOperationsOptions): UseItemOperationsReturn {
  const {
    rootItems,
    setRootItems,
    setExpandedIds,
    setSelectedItemId,
    setSidebarEditingItemId,
    setWorkbenchTree,
    setDeleteConfirmation,
    projectUuid
  } = options
  const { openFolderTab, openScenarioEditorTab, openEnvironmentFolderTab, openAnyRequestTab } = options
  const { t } = useTranslation()

  // Handle drag & drop in the sidebar to reorder items
  const handleItemDrop = useCallback((payload: ListViewDropEventPayload) => {
    const sourceId = payload.source.id
    const targetId = payload.item.id
    const position = payload.position

    // Don't allow dropping an item onto itself
    if (sourceId === targetId) return

    // Don't allow dropping a root folder (they are top-level)
    const isRootItem = rootItems.some((f) => f.id === sourceId)
    if (isRootItem) return

    // Don't allow dropping onto a root folder with 'before' or 'after' (only 'into')
    const isTargetRootFolder = rootItems.some((f) => f.id === targetId)
    if (isTargetRootFolder && position !== 'into') return

    // Don't allow dropping a folder into one of its descendants
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = findItemById(rootItems, parentId)
      if (!parent || !isAnyFolder(parent)) return false
      for (const item of parent.items) {
        if (item.id === childId) return true
        if (isAnyFolder(item) && isDescendant(item.id, childId)) return true
      }
      return false
    }
    if (isDescendant(sourceId, targetId)) return

    // Remove the item from its current position
    const removedItem = removeItemFromTree(rootItems, sourceId)
    if (!removedItem) return

    // Insert at the new position
    const inserted = insertItemIntoTree(rootItems, removedItem, targetId, position)
    if (!inserted) {
      // If insertion failed, try to restore the item (this shouldn't happen)
      return
    }

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    // Recalculate breadcrumbs for a single tab after the reorder. Returns
    // the tab unchanged for singleton tabs (Console / Firewall, which aren't
    // tied to a tree item) and when the item can no longer be located.
    const refreshTabBreadcrumbs = (
      tab: EditorTab
    ): EditorTab | FolderTab | EnvironmentFolderTab | HTTPRequestTab | ScenarioEditorTab => {
      const tabType = (tab as { tabType?: string }).tabType
      // Singleton tabs (Console, Firewall) aren't tied to any tree item —
      // skip them. Without this guard the `else` branch below would
      // dereference `.request.id` on a tab that doesn't carry one and crash
      // with "Cannot read properties of undefined (reading 'id')".
      if (tabType === 'console' || tabType === 'firewall') {
        return tab
      }
      const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab | ScenarioEditorTab

      // Get the item ID from the tab. Scenario-editor tabs carry their
      // payload under `scenario` (not `request` / `folder`); without this
      // branch the breadcrumb refresh after a sidebar drag-and-drop would
      // hit the `else` and dereference `.request.id` on the wrong shape.
      let itemId: string
      if (restormTab.tabType === 'folder') {
        itemId = restormTab.folder.id
      } else if (restormTab.tabType === 'environment-folder') {
        itemId = restormTab.folder.id
      } else if (restormTab.tabType === 'scenario-editor') {
        itemId = restormTab.scenario.id
      } else {
        itemId = restormTab.request.id
      }

      const { breadcrumbs: newBreadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      if (newBreadcrumbs.length === 0) return tab

      // For HTTP request tabs the environments are left as-is for now
      // (recalculating them would need getNearestEnvironmentsForBreadcrumbs).
      return {
        ...restormTab,
        breadcrumbs: newBreadcrumbs
      }
    }

    // Update breadcrumbs in EVERY open workbench tab, recursing into the
    // container nodes of split-pane layouts. The previous implementation only
    // rewrote `groups[0]` and returned a single-element groups array, which
    // silently dropped every other pane — so reordering a sidebar item with a
    // side-by-side split open collapsed the second group.
    setWorkbenchTree((prevTree) => ({
      ...prevTree,
      groups: mapAllWorkbenchTabs(prevTree.groups, refreshTabBreadcrumbs)
    }))
  }, [rootItems, setRootItems, setWorkbenchTree])

  // Handle "Clone" context menu action. Works for any item — including a
  // ROOT-level folder / environment folder (cloneItemInTree inserts the deep
  // copy back into the root list when there's no parent).
  const handleCloneItem = useCallback((itemId: string) => {
    const clonedItem = cloneItemInTree(rootItems, itemId, t('sidebar.contextMenu.copySuffix', 'copy'))
    if (!clonedItem) return

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    // Open the clone in the workbench, as a click on it would.
    const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, clonedItem.id)
    if (breadcrumbs.length > 0) {
      if (isScenario(clonedItem)) {
        openScenarioEditorTab(clonedItem, breadcrumbs)
      } else if (isEnvironmentFolder(clonedItem)) {
        openEnvironmentFolderTab(clonedItem, breadcrumbs)
      } else if (isFolder(clonedItem)) {
        openFolderTab(clonedItem, breadcrumbs)
      } else if (isRequest(clonedItem)) {
        const envs = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
        openAnyRequestTab(clonedItem, breadcrumbs, envs)
      }
    }
  }, [rootItems, setRootItems, t, openFolderTab, openScenarioEditorTab, openEnvironmentFolderTab, openAnyRequestTab])

  // Handle "Delete" context menu action - show confirmation
  const handleDeleteItem = useCallback((itemId: string) => {
    // Find the item to get its name and type
    const item = findItemById(rootItems, itemId)
    if (!item) return

    const isFolderItem = isAnyFolder(item)
    setDeleteConfirmation({
      isOpen: true,
      itemId,
      itemName: item.name,
      isFolder: isFolderItem
    })
  }, [rootItems, setDeleteConfirmation])

  // Confirm deletion
  const confirmDelete = useCallback((itemId: string) => {
    // Collect every id reachable from the about-to-delete subtree —
    // including the root id itself — so we can sweep favorites in one
    // pass once the tree mutation has happened. Walking BEFORE removal
    // lets us see the descendants; the favorites cleanup runs after so
    // listeners on `restorm:favorites-changed` don't race the tree.
    const subtreeIds = new Set<string>()
    const collect = (id: string): void => {
      subtreeIds.add(id)
      const node = findItemById(rootItems, id)
      if (node && isAnyFolder(node)) {
        for (const child of node.items) collect(child.id)
      }
    }
    collect(itemId)

    // Remove the item from the tree (handles nested items)
    const removed = removeItemFromTree(rootItems, itemId)
    if (!removed) {
      // Root-level item: remove directly from rootItems
      setRootItems((prev) => prev.filter((f) => f.id !== itemId))
    }

    // Close any tabs that reference the deleted item — in EVERY group,
    // including tab-groups nested inside split containers (a tab dragged into
    // a lower group must still close). Recurse into container nodes and prune
    // emptied tab-groups + emptied containers. `tabReferencesItem` matches
    // request (any protocol) / folder / scenario tabs + breadcrumb trails —
    // the old local check missed scenario-editor tabs and non-HTTP requests,
    // leaving their tabs open (and editable) after the item was deleted.
    const tabReferencesDeleted = (tab: EditorTab): boolean => tabReferencesItem(tab, itemId)
    const pruneGroups = (nodes: WorkbenchTree['groups']): WorkbenchTree['groups'] => {
      const result: WorkbenchTree['groups'] = []
      for (const node of nodes) {
        if (isContainerNode(node)) {
          const prunedChildren = pruneGroups(node.groups)
          if (prunedChildren.length > 0) result.push({ ...node, groups: prunedChildren })
          continue
        }
        if (!isTabGroupNode(node)) {
          result.push(node)
          continue
        }
        const filteredTabs = node.tabs.filter((tab) => !tabReferencesDeleted(tab))
        if (filteredTabs.length === 0) continue
        let newActiveTabId: string = node.activeTabId ?? ''
        if (!filteredTabs.some((t) => t.id === node.activeTabId)) {
          newActiveTabId = filteredTabs[0]?.id ?? ''
        }
        result.push({ ...node, tabs: filteredTabs, activeTabId: newActiveTabId })
      }
      return result
    }
    setWorkbenchTree((prevTree) => ({ ...prevTree, groups: pruneGroups(prevTree.groups) }))

    // Force React re-render
    setRootItems((prevItems) => [...prevItems])

    // Cascade: drop every deleted id from the favorites store. The
    // favorites pane in the sidebar listens to `restorm:favorites-changed`
    // (dispatched from `removeFavorite`) so it re-renders without a
    // ghost row. Folder deletions sweep every favorited descendant.
    if (projectUuid) {
      for (const id of subtreeIds) favoritesStoreRemove(projectUuid, id)
    }

    // Close the confirmation modal
    setDeleteConfirmation((prev) => ({ ...prev, isOpen: false }))
  }, [rootItems, setRootItems, setWorkbenchTree, setDeleteConfirmation, projectUuid])

  // Cancel deletion
  const cancelDelete = useCallback(() => {
    setDeleteConfirmation((prev) => ({ ...prev, isOpen: false }))
  }, [setDeleteConfirmation])

  // Handle item rename from sidebar ListView
  const handleSidebarItemRename = useCallback((payload: ListViewItemEventPayload, newName: string) => {
    const itemId = payload.item.id

    // Find and update the reactive object directly (triggers search re-indexing)
    const foundItem = findItemById(rootItems, itemId)
    if (foundItem) {
      foundItem.name = newName
    }

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    // Also update the workbench tab title and breadcrumbs (all groups)
    setWorkbenchTree((prevTree) => {
      const updatedGroups = prevTree.groups.map((group) => {
        if (!isTabGroupNode(group)) return group

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

          // Update tab title if it's the renamed item
          if (restormTab.tabType === 'folder' && restormTab.folder.id === itemId) {
            return {
              ...restormTab,
              title: newName,
              titleString: newName,
              folder: { ...restormTab.folder, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === itemId) {
            return {
              ...restormTab,
              title: newName,
              titleString: newName,
              folder: { ...restormTab.folder, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          if (restormTab.tabType === 'http-request' && restormTab.request.id === itemId) {
            const newTitle = `${restormTab.request.method} ${newName}`
            return {
              ...restormTab,
              title: newTitle,
              titleString: newTitle,
              request: { ...restormTab.request, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          // Update breadcrumbs for other tabs that might reference this item
          if (restormTab.breadcrumbs) {
            const hasMatch = restormTab.breadcrumbs.some((bc) => bc.id === itemId)
            if (hasMatch) {
              const updatedBreadcrumbs = restormTab.breadcrumbs.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              )
              return { ...restormTab, breadcrumbs: updatedBreadcrumbs, contentVersion: (restormTab.contentVersion ?? 0) + 1 }
            }
          }

          return tab
        })

        return { ...group, tabs: updatedTabs }
      })

      return { ...prevTree, groups: updatedGroups }
    })

    // Notify external listeners (sidebar Favorites + Open documents
    // panes) that an item's `name` mutated in-place. Cheap signal that
    // doesn't require those panes to depend on a reference flip in
    // `rootItems` — which doesn't happen because the rename is an
    // in-place mutation.
    window.dispatchEvent(new CustomEvent('restorm:item-renamed', { detail: { id: itemId } }))
  }, [rootItems, setRootItems, setWorkbenchTree])

  // Default names for each kind the sidebar's Ajouter submenu can
  // create. Matches the submenu label order, intentionally untranslated
  // so the user can rename in place via F2 without the default drifting
  // with locale.
  const defaultNameFor = useCallback((kind: AddChildKind): string => {
    switch (kind) {
      case 'folder': return t('sidebar.newFolder')
      case 'http-get': return 'New GET request'
      case 'http-post': return 'New POST request'
      case 'http-put': return 'New PUT request'
      case 'http-patch': return 'New PATCH request'
      case 'http-delete': return 'New DELETE request'
      case 'http-server': return 'New HTTP mock server'
      case 'graphql': return 'New GraphQL request'
      case 'graphql-server': return 'New GraphQL mock server'
      case 'grpc': return 'New gRPC request'
      case 'grpc-server-stream': return 'New gRPC server-streaming request'
      case 'grpc-client-stream': return 'New gRPC client-streaming request'
      case 'grpc-bidi': return 'New gRPC bidirectional request'
      case 'grpc-server': return 'New gRPC mock server'
      case 'soap': return 'New SOAP request'
      case 'soap-server': return 'New SOAP mock server'
      case 'websocket': return 'New WebSocket request'
      case 'socketio': return 'New Socket.IO request'
      case 'socketio-server': return 'New Socket.IO server'
      case 'websocket-server': return 'New WebSocket server'
      case 'mqtt': return 'New MQTT request'
      case 'mqtt-server': return 'New MQTT broker'
      case 'sse': return 'New SSE request'
      case 'odata': return 'New OData request'
      case 'odata-server': return 'New OData mock server'
      case 'auth': return 'New auth request'
      case 'trpc': return 'New tRPC request'
      case 'scenario': return 'New scenario'
    }
  }, [t])

  const handleAddChildItem = useCallback((parentId: string, kind: AddChildKind, options?: { silent?: boolean }): string | null => {
    // `parentId === ''` is the ROOT sentinel — used by the empty-area
    // sidebar context menu so users can add a top-level folder /
    // request without first creating a parent. For non-root cases we
    // resolve the parent + its ancestor chain up front and append the
    // child's breadcrumb locally (the closure-captured `rootItems`
    // would be pre-update after `setRootItems`).
    const isRoot = parentId === ''
    const parentLookup = isRoot
      ? null
      : findItemWithBreadcrumbs(rootItems, parentId)
    const parent = parentLookup?.item ?? null
    // A parent can be a folder/env-folder OR a scenario (scenarios double as
    // containers for requests authored inside them).
    const parentIsContainer = !!parent && (isAnyFolder(parent) || isScenario(parent))
    if (!isRoot && !parentIsContainer) return null
    const parentBreadcrumbs = parentLookup?.breadcrumbs ?? []
    const name = defaultNameFor(kind)
    const id = generateUniqueId()

    // Append the reactive item under the right parent. The two arms
    // are intentionally distinct because they hit different React
    // signals: a root append goes through `setRootItems` (state set ->
    // React re-render), a folder append mutates a Proxy-wrapped array
    // in place, which in turn emits REQUEST/FOLDER_UPDATED via the
    // array proxy handler — but since `rootItems` itself didn't change
    // identity, we still need to nudge React with `setRootItems((prev)
    // => [...prev])` so the sidebar's `.map(rootItems)` re-runs and
    // picks the new descendant up.
    const mountChild = (reactive: FolderItem): void => {
      if (isRoot) {
        setRootItems((prev) => [...prev, reactive])
      } else if (parent && isAnyFolder(parent)) {
        parent.items.push(reactive)
      } else if (parent && isScenario(parent)) {
        // Scenario container: its `items` is optional — seed it then append.
        const scn = parent as { items?: FolderItem[] }
        scn.items ??= []
        scn.items.push(reactive)
      }
    }

    // Build a plain item then wrap it reactive; mirrors the shapes
    // `useImport` produces on import so the save-unit registry /
    // serializer / executors all pick them up without special casing.
    let pushedItem: FolderItem
    if (kind === 'scenario') {
      // A scenario is a plain tree item (no execution wiring yet in
      // Phase 1). It syncs to main via `collections:sync` and reifies
      // into a `Scenario` model there; no per-item document event is
      // needed (there's no ContextService/search registration to do).
      const scenario = {
        type: 'scenario' as const,
        id,
        name,
        tags: [] as string[],
        params: [],
        nodes: [],
        edges: [],
        // A scenario doubles as a folder-like container for requests authored
        // inside it; starts empty.
        items: [] as FolderItem[]
      }
      mountChild(scenario as unknown as FolderItem)
      pushedItem = scenario as unknown as FolderItem
    } else if (kind === 'folder') {
      const folder: Folder = {
        id,
        name,
        tags: [],
        configuration: {},
        items: []
      }
      const reactive = makeReactiveFolder(folder)
      mountChild(reactive)
      pushedItem = reactive
      // Strip the proxy before sending over IPC — `eventBus.emitSync`
      // goes through `structuredClone` which can't ferry Proxy
      // wrappers. `cloneForEventBus` rather than the JSON round-trip
      // so `SecretValue.toJSON()` doesn't strip the plaintext on
      // its way to main (matters when the folder being created
      // carries an environment with secrets — main needs them for
      // handlebars resolution and for the next `.restorm.env` write).
      const folderPayload: DocumentChangedPayload = {
        id: reactive.id,
        type: 'folder',
        document: cloneForEventBus(reactive)
      }
      eventBus.emitSync(DocumentEvents.FOLDER_CREATED, folderPayload)
    } else {
      // The class instances structurally satisfy the structural
      // `Request` union in `shared/types/requests`, but TS's
      // `exactOptionalPropertyTypes: true` can't prove the match because
      // the class-side `type` field is typed as the full union on
      // `BaseRequest`. Cast through `unknown` once at the boundary
      // rather than threading class unions everywhere downstream.
      const httpMethod: HTTPMethod | undefined =
        kind === 'http-get' ? 'GET' :
          kind === 'http-post' ? 'POST' :
            kind === 'http-put' ? 'PUT' :
              kind === 'http-patch' ? 'PATCH' :
                kind === 'http-delete' ? 'DELETE' :
                  undefined
      let built: unknown
      if (httpMethod !== undefined) {
        built = new HTTPRequest({ id, name, method: httpMethod })
      } else if (kind === 'http-server') {
        // restorm acts as a local HTTP mock server: HTTP request + server flag,
        // host forced to localhost, default port + route + 200 status pre-filled.
        built = new HTTPRequest({ id, name, method: 'GET', server: true, url: 'localhost:8080/', mockStatus: 200 })
      } else if (kind === 'graphql') {
        built = new GraphQLRequest({ id, name })
      } else if (kind === 'graphql-server') {
        // restorm acts as a local GraphQL mock server: GraphQL request + server
        // flag, host forced to localhost, default port + /graphql endpoint, and
        // a minimal SDL + canned resolver pre-filled so it answers out of the box.
        built = new GraphQLRequest({
          id,
          name,
          server: true,
          url: 'localhost:4000/graphql',
          schema: 'type Query {\n  hello: String\n}',
          mockResolvers: '{\n  "Query.hello": "Hello from restorm"\n}'
        })
      } else if (kind === 'grpc' || kind === 'grpc-server-stream' || kind === 'grpc-client-stream' || kind === 'grpc-bidi') {
        const callType =
          kind === 'grpc-server-stream' ? 'server-stream' :
            kind === 'grpc-client-stream' ? 'client-stream' :
              kind === 'grpc-bidi' ? 'bidirectional-stream' :
                'unary'
        built = new GrpcRequest({ id, name, callType })
      } else if (kind === 'grpc-server') {
        // restorm acts as a local gRPC mock server: gRPC request + server flag,
        // host forced to localhost, default port 50051 + a starter proto + one
        // unary mock method so the server is runnable the moment it is created.
        built = new GrpcRequest({
          id,
          name,
          server: true,
          url: 'localhost:50051',
          reflection: true,
          protoContent: GRPC_MOCK_STARTER_PROTO,
          mockMethods: [{
            service: 'mock.MockService',
            method: 'Unary',
            callType: 'unary',
            responseMessage: '{\n  "message": "hello from restorm mock"\n}'
          }]
        })
      } else if (kind === 'soap') {
        built = new SoapRequest({ id, name })
      } else if (kind === 'soap-server') {
        // restorm acts as a local SOAP mock server: SOAP request + server flag,
        // host forced to localhost, default port + route pre-filled, seeded with
        // one canned operation + one fault operation so it answers out of the box.
        built = new SoapRequest({
          id,
          name,
          server: true,
          url: 'localhost:8080/',
          mockOperations: [
            { name: 'Echo', responseBody: '<EchoResponse><message>Hello from restorm</message></EchoResponse>' },
            { name: 'Fault', responseBody: 'Mock fault', isFault: true }
          ]
        })
      } else if (kind === 'websocket') {
        built = new WebSocketRequest({ id, name })
      } else if (kind === 'socketio') {
        // Socket.IO CLIENT request (connects to a Socket.IO server).
        built = new WebSocketRequest({ id, name, protocol: 'socketio' })
      } else if (kind === 'socketio-server') {
        // restorm acts as a Socket.IO server: socketio protocol + server flag,
        // host forced to localhost, default port pre-filled.
        built = new WebSocketRequest({ id, name, protocol: 'socketio', server: true, url: 'localhost:3001' })
      } else if (kind === 'websocket-server') {
        // restorm acts as a raw WebSocket server: websocket protocol + server
        // flag, host forced to localhost, default port pre-filled.
        built = new WebSocketRequest({ id, name, protocol: 'websocket', server: true, url: 'localhost:3002' })
      } else if (kind === 'mqtt') {
        // MQTT CLIENT request (connects to a broker); default subscribe-on-connect.
        built = new WebSocketRequest({ id, name, protocol: 'mqtt', url: 'mqtt://localhost:1883' })
      } else if (kind === 'mqtt-server') {
        // restorm hosts a local MQTT broker: mqtt protocol + server flag, host
        // forced to localhost, default broker port pre-filled. The topic on the
        // request is the filter the broker surfaces in the chat (default `#`).
        built = new WebSocketRequest({ id, name, protocol: 'mqtt', server: true, url: 'mqtt://localhost:1883', event: '#' })
      } else if (kind === 'sse') {
        built = new SseRequest({ id, name })
      } else if (kind === 'odata') {
        built = new ODataRequest({ id, name })
      } else if (kind === 'odata-server') {
        // restorm acts as a local OData v4 mock service: OData request + server
        // flag, host forced to localhost, default port 8081 + service root, plus
        // a starter CSDL + entity data so it is runnable the moment it is created.
        built = new ODataRequest({
          id,
          name,
          server: true,
          url: 'localhost:8081/odata',
          mockMetadata: ODATA_MOCK_STARTER_METADATA,
          mockData: ODATA_MOCK_STARTER_DATA
        })
      } else if (kind === 'trpc') {
        built = new TrpcRequest({ id, name })
      } else {
        built = new AuthenticationRequest({ id, name })
      }
      const request = built as Request
      const resolvedParentId = isRoot
        ? undefined
        : (parent && (isAnyFolder(parent) || isScenario(parent)) ? parent.id : undefined)
      const reactive = resolvedParentId !== undefined
        ? makeReactiveRequest(request, resolvedParentId)
        : makeReactiveRequest(request)
      mountChild(reactive)
      pushedItem = reactive
      const createdPayload: DocumentChangedPayload = {
        id: reactive.id,
        type: 'request',
        document: cloneForEventBus(reactive),
        ...(resolvedParentId !== undefined ? { parentFolderId: resolvedParentId } : {})
      }
      eventBus.emitSync(DocumentEvents.REQUEST_CREATED, createdPayload)
    }

    // `silent` (a request created inline in a scenario graph) skips ALL
    // navigation — no parent expand, no sidebar selection, no tab — so the user
    // stays on the graph and the sidebar doesn't jump. The tree still re-renders
    // (the `[...prevItems]` nudge) so the new child shows once its parent is
    // expanded; see the `mountChild` comment for why the nudge is needed.
    const silent = options?.silent === true
    if (!isRoot) {
      if (!silent) setExpandedIds((prev) => Array.from(new Set([...prev, parentId])))
      setRootItems((prevItems) => [...prevItems])
    }
    if (!silent) setSelectedItemId(id)

    if (!silent) {
      const newBreadcrumb: BreadcrumbItem = {
        id,
        label: name,
        icon: isAnyFolder(pushedItem) ? getFolderIcon(pushedItem) : null
      }
      const breadcrumbs = [...parentBreadcrumbs, newBreadcrumb]
      const envs = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
      if (kind === 'folder' && isAnyFolder(pushedItem)) {
        openFolderTab(pushedItem, breadcrumbs)
      } else if (isScenario(pushedItem)) {
        openScenarioEditorTab(pushedItem, breadcrumbs)
      } else if (!isAnyFolder(pushedItem)) {
        openAnyRequestTab(pushedItem, breadcrumbs, envs)
      }
    }
    return id
  }, [rootItems, setRootItems, setExpandedIds, setSelectedItemId, openFolderTab, openScenarioEditorTab, openAnyRequestTab, defaultNameFor])

  const handleCreateRootFolder = useCallback(() => {
    const newFolder: Folder = {
      id: generateUniqueId(),
      name: t('sidebar.newFolder'),
      tags: [],
      configuration: {},
      items: []
    }
    setRootItems((prev) => [...prev, newFolder])
    setSelectedItemId(newFolder.id)
    // Announce the creation so the save-unit registry learns about the new root
    // folder (crash-recovery draft) — child folders emit this; root ones didn't.
    eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
      id: newFolder.id,
      type: 'folder',
      document: cloneForEventBus(newFolder)
    } as DocumentChangedPayload)
    const breadcrumbs = [{ id: newFolder.id, label: newFolder.name, icon: getFolderIcon(newFolder) }]
    openFolderTab(newFolder, breadcrumbs)
    setTimeout(() => {
      setSidebarEditingItemId(newFolder.id)
    }, 0)
  }, [setRootItems, setSelectedItemId, setSidebarEditingItemId, openFolderTab, t])

  const handleCreateRootEnvironmentFolder = useCallback(() => {
    const newFolder: EnvironmentFolder = {
      id: generateUniqueId(),
      name: t('sidebar.newEnvironmentFolder'),
      folderType: 'environment',
      fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
      tags: [],
      configuration: {},
      environments: [],
      items: []
    }
    setRootItems((prev) => [...prev, newFolder])
    setSelectedItemId(newFolder.id)
    // Announce the creation (FOLDER_CREATED — the main-side handler keys on
    // type:'folder'; an EnvironmentFolder is a folder with folderType:'environment')
    // so the save-unit registry learns about the new root env-folder.
    eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
      id: newFolder.id,
      type: 'folder',
      document: cloneForEventBus(newFolder)
    } as DocumentChangedPayload)
    const breadcrumbs = [{ id: newFolder.id, label: newFolder.name, icon: getFolderIcon(newFolder) }]
    openEnvironmentFolderTab(newFolder, breadcrumbs)
    setTimeout(() => {
      setSidebarEditingItemId(newFolder.id)
    }, 0)
  }, [setRootItems, setSelectedItemId, setSidebarEditingItemId, openEnvironmentFolderTab, t])

  return {
    handleItemDrop,
    handleCloneItem,
    handleCreateRootFolder,
    handleCreateRootEnvironmentFolder,
    handleAddChildItem,
    handleDeleteItem,
    confirmDelete,
    cancelDelete,
    handleSidebarItemRename
  }
}
