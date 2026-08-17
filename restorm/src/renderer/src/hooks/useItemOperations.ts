/**
 * Hook for managing item operations (CRUD) in the sidebar
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewDropEventPayload, ListViewDropPosition, ListViewItemEventPayload } from 'electron-core-ui/renderer'
import { isTabGroupNode, isContainerNode } from 'electron-core-ui/renderer'
import type { Environment, Folder, EnvironmentFolder, Request, FolderItem } from '../../../shared/types/collections'
import { isAnyFolder, isScenario, isApiDesign, isEnvironmentFolder, isFolder, isRequest } from '../../../shared/types/collections'
import { parseDesignSectionRowId } from '../../../shared/design/designSections'
import {
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest,
  SseRequest,
  StompRequest,
  ODataRequest,
  AuthenticationRequest,
  TrpcRequest,
  AmqpRequest,
  RedisRequest,
  KafkaRequest
} from '../../../shared/models/requests'
import type { HTTPMethod } from '../../../shared/models/types'
import { findItemById, findItemWithParent, findItemWithBreadcrumbs, getFolderIcon, getNearestEnvironmentsForBreadcrumbs } from '../utils/treeSearch'
import { cloneForEventBus } from '../utils/cloneForEventBus'
import { generateUniqueId, cloneItemInTree, removeItemFromTree, insertItemIntoTree } from '../utils/treeManipulation'
import { mapAllWorkbenchTabs, tabBackingItemId, tabReferencesItem } from '../utils/workbenchTabs'
import { requestTabTitle } from '../../../shared/protocolRegistry'
import type { WorkbenchTree, EditorTab } from 'electron-core-ui/renderer'
import type { BreadcrumbItem, FolderTab, EnvironmentFolderTab, HTTPRequestTab, ScenarioEditorTab, RestormEditorTab } from '../../../shared/types/editor'
import { makeReactiveFolder, makeReactiveRequest, makeReactiveFolderItem, makeReactiveApiDesign } from '../types/reactive'
import { DocumentEvents, type DocumentChangedPayload, type DocumentDeletedPayload } from '../services/DocumentEvents'
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
  openDesignTab: (design: import('../../../shared/types/collections').ApiDesign, breadcrumbs: BreadcrumbItem[]) => void
  /** Project UUID. When the deleted subtree contains favorited items,
   * each id is removed from the favorites store under this key. */
  projectUuid: string | null
  /** Called when a moved item has no save-unit document type of its own
   * (a scenario). The host persists those through its own debounced
   * whole-file save — the same path it already uses for scenario edits. */
  onStructureChanged?: () => void
}

export interface UseItemOperationsReturn {
  handleItemDrop: (payload: ListViewDropEventPayload) => void
  /** Hover-time coherence check for a sidebar drag — the ListView `canDrop`
   * feeds on this: same rules the drop itself enforces, so an invalid
   * gesture is flagged (ghost error badge, no indicator) instead of being
   * silently swallowed at release. */
  canDropSelection: (sourceIds: string[], targetId: string, position: ListViewDropPosition) => boolean
  /** Empty-area drop: moves the dragged rows to the END of the root list. */
  handleEmptyAreaDrop: (sources: ListViewItemEventPayload[]) => void
  handleCloneItem: (itemId: string) => void
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

/**
 * Emit the document-created events for a freshly cloned subtree so the new
 * items reach the save-unit registry (dirty → autosave rewrites the file, the
 * git push badge lights) and the main-process search index — the same signals
 * a normal create fires. `cloneItemInTree` only splices the deep copy into the
 * tree; without these events the clone is invisible to both autosave and search
 * until the next full file load.
 *
 * Mirrors the import path: one CREATED event per item — FOLDER_CREATED for
 * folders / environment folders, ENVIRONMENT_CREATED for every env / sub-env on
 * an environment folder (so ContextService can resolve handlebars variables),
 * REQUEST_CREATED for requests (carrying `parentFolderId` when nested).
 * Scenarios carry no per-item document event (they sync via `collections:sync`,
 * mirroring `handleAddChildItem`); their nested requests still get theirs.
 * `cloneForEventBus` (not a JSON round-trip) preserves `SecretValue` plaintext
 * on the way to main.
 *
 * Each event is delivered on BOTH buses (like reactive.ts's `emitBoth` for
 * updates): `emitSync` reaches the main-process subscribers (search index,
 * ContextService), and `emitLocalSync` reaches the renderer-local save-unit
 * bridge that marks the new unit dirty — which is what drives autosave (file
 * rewrite + git push badge) and the unsaved-window indicator. A main-only
 * delivery indexes the clone for search but never marks it dirty, so the copy
 * silently vanishes on close in autosave-off mode and never round-trips to disk.
 */
/** Both buses, always: the local one carries the renderer-side bridge that
 * marks the unit dirty (autosave, push badge, unsaved-window indicator),
 * while a main-only delivery would index for search and nothing more. */
function emitBothBuses(event: string, payload: DocumentChangedPayload | DocumentDeletedPayload): void {
  eventBus.emitSync(event, payload)
  eventBus.emitLocalSync(event, payload)
}

export function emitClonedSubtreeCreated(item: FolderItem, parentFolderId?: string): void {
  const emitEnvironmentTree = (env: Environment, envFolderId: string, parentEnvironmentId: string | null): void => {
    emitBothBuses(DocumentEvents.ENVIRONMENT_CREATED, {
      id: env.id,
      type: 'environment',
      document: cloneForEventBus(env),
      parentFolderId: envFolderId,
      parentEnvironmentId: parentEnvironmentId ?? undefined
    } as DocumentChangedPayload)
    for (const child of env.subEnvironments ?? []) emitEnvironmentTree(child, envFolderId, env.id)
  }

  if (isScenario(item)) {
    for (const child of (item as { items?: FolderItem[] }).items ?? []) {
      emitClonedSubtreeCreated(child, item.id)
    }
    return
  }
  if (isAnyFolder(item)) {
    emitBothBuses(DocumentEvents.FOLDER_CREATED, {
      id: item.id,
      type: 'folder',
      document: cloneForEventBus(item)
    } as DocumentChangedPayload)
    if (isEnvironmentFolder(item)) {
      for (const env of item.environments) emitEnvironmentTree(env, item.id, null)
    }
    for (const child of item.items) emitClonedSubtreeCreated(child, item.id)
    return
  }
  if (isApiDesign(item)) {
    emitBothBuses(DocumentEvents.DESIGN_CREATED, {
      id: item.id,
      type: 'design',
      document: cloneForEventBus(item),
      ...(parentFolderId !== undefined ? { parentFolderId } : {})
    } as DocumentChangedPayload)
    return
  }
  emitBothBuses(DocumentEvents.REQUEST_CREATED, {
    id: item.id,
    type: 'request',
    document: cloneForEventBus(item),
    ...(parentFolderId !== undefined ? { parentFolderId } : {})
  } as DocumentChangedPayload)
}

/** The update event + payload type an item announces when it MOVES.
 * Designs and folders carry their own save-unit document kinds —
 * announcing a design as 'request' would have the save-unit bridge
 * cleanse its draft against the HTTP request shape and drop every
 * design section, leaving the unit dirty forever. */
function movedItemAnnouncement(item: FolderItem): { event: (typeof DocumentEvents)[keyof typeof DocumentEvents]; type: DocumentChangedPayload['type'] } {
  if (isAnyFolder(item)) return { event: DocumentEvents.FOLDER_UPDATED, type: 'folder' }
  if (isApiDesign(item)) return { event: DocumentEvents.DESIGN_UPDATED, type: 'design' }
  return { event: DocumentEvents.REQUEST_UPDATED, type: 'request' }
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
    projectUuid,
    onStructureChanged
  } = options
  const { openFolderTab, openScenarioEditorTab, openEnvironmentFolderTab, openAnyRequestTab, openDesignTab } = options
  const { t } = useTranslation()

  // Coherence rules for a (possibly multi-item) sidebar drag. Shared verbatim
  // between the hover validation (ListView's `canDrop` — ghost error badge,
  // suppressed indicator) and the drop handler below, so what LOOKS invalid
  // and what IS refused can never drift apart.
  const canDropSelection = useCallback((sourceIds: string[], targetId: string, position: ListViewDropPosition): boolean => {
    if (sourceIds.length === 0) return false
    // An item can't land on itself.
    if (sourceIds.includes(targetId)) return false
    // A design's virtual section rows are not tree items and never move;
    // a selection carrying one refuses the drop WHOLESALE (the design
    // itself, a real item, stays draggable).
    if (sourceIds.some((id) => parseDesignSectionRowId(id) !== null)) return false

    // Is `childId` anywhere inside `parentId`'s subtree?
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = findItemById(rootItems, parentId)
      if (!parent || !('items' in parent)) return false
      for (const item of (parent.items ?? [])) {
        if (item.id === childId) return true
        if ('items' in item && isDescendant(item.id, childId)) return true
      }
      return false
    }

    const target = findItemById(rootItems, targetId)
    if (!target) return false

    // The chain of containers the drop actually lands IN: the target itself
    // when dropping INTO a container, its ancestors otherwise (siblings
    // share them; 'into' a LEAF degrades to insert-after, same ancestors).
    const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, targetId)
    const intoContainer = position === 'into' && (isAnyFolder(target) || isScenario(target))
    const destinationChainIds = (intoContainer ? breadcrumbs : breadcrumbs.slice(0, -1)).map((bc) => bc.id)

    for (const sourceId of sourceIds) {
      const source = findItemById(rootItems, sourceId)
      if (!source) return false
      // A container can never land inside its own subtree.
      if (isDescendant(sourceId, targetId)) return false
      // An ENVIRONMENT FOLDER can only live outside every other environment
      // folder and outside every scenario — checked recursively over the
      // whole destination chain, not just the direct target: dropping one
      // before/after a request nested in an env folder would otherwise
      // sneak it inside. The rule covers env folders hidden anywhere in the
      // dragged SUBTREE too (a plain folder carrying an env folder must not
      // smuggle it in).
      const subtreeHasEnvFolder = (node: FolderItem): boolean => {
        if (isEnvironmentFolder(node)) return true
        if (!('items' in node)) return false
        return (node.items ?? []).some((child) => subtreeHasEnvFolder(child))
      }
      if (subtreeHasEnvFolder(source)) {
        for (const chainId of destinationChainIds) {
          const container = findItemById(rootItems, chainId)
          if (container && (isEnvironmentFolder(container) || isScenario(container))) return false
        }
      }
    }
    return true
  }, [rootItems])

  // Refresh breadcrumbs in EVERY open workbench tab after a tree move —
  // shared by the row-target drop and the empty-area (move-to-root) drop.
  const refreshAllTabBreadcrumbs = useCallback(() => {
    // Recalculate breadcrumbs for a single tab after the reorder. Returns the
    // tab unchanged when it backs onto no tree item at all (every singleton:
    // Console, Firewall, Settings, the mini-browser, the MCP logs) and when
    // the item it does back onto can no longer be located.
    const refreshTabBreadcrumbs = (
      tab: EditorTab
    ): EditorTab | FolderTab | EnvironmentFolderTab | HTTPRequestTab | ScenarioEditorTab => {
      // Which tree item this tab is bound to — via the shared helper, which
      // reads the id off whichever payload the tab carries (`request` for
      // every protocol tab, `folder`, or `scenario`) and yields `undefined`
      // for tabs backed by no tree item at all.
      //
      // Reimplementing that extraction here is what crashed the app: this
      // function used to skip two known singletons (Console, Firewall) by
      // tabType and then dereference `.request.id` on everything else — so
      // with the mini-browser, Settings or the MCP logs open, ANY sidebar
      // drag threw "Cannot read properties of undefined (reading 'id')" out
      // of this map and the error boundary tore the whole UI down. One
      // source of truth means a tab kind added later cannot resurrect it.
      const boundItemId = tabBackingItemId(tab)
      if (boundItemId === undefined) return tab
      const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab | ScenarioEditorTab

      const { breadcrumbs: newBreadcrumbs } = findItemWithBreadcrumbs(rootItems, boundItemId)
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

  }, [rootItems, setWorkbenchTree])

  // Handle drag & drop in the sidebar to reorder / move items — including a
  // MULTI-selection drag (payload.sources) and items sitting at the ROOT
  // (both as source and as before/after target).
  const handleItemDrop = useCallback((payload: ListViewDropEventPayload) => {
    const sourceIds = (payload.sources.length > 0 ? payload.sources : [{ item: payload.source, path: payload.sourcePath }])
      .map((s) => s.item.id)
    const targetId = payload.item.id
    const position = payload.position

    if (!canDropSelection(sourceIds, targetId, position)) return

    // Resolves an item's containing folder — used AFTER the move to report
    // where the item landed.
    const findParentFolder = (nodes: FolderItem[], childId: string): FolderItem | null => {
      for (const node of nodes) {
        if (!isAnyFolder(node)) continue
        if (node.items.some((child) => child.id === childId)) return node
        const deeper = findParentFolder(node.items, childId)
        if (deeper) return deeper
      }
      return null
    }

    // Extract every dragged item, in visual order. A source that is itself
    // a DESCENDANT of an earlier source has already left the tree with its
    // container — skipping it (removeItemFromTree returns null) is what
    // keeps "folder + its own child selected together" a single move.
    const removedItems: FolderItem[] = []
    for (const sourceId of sourceIds) {
      const removed = removeItemFromTree(rootItems, sourceId)
      if (removed) removedItems.push(removed)
    }
    if (removedItems.length === 0) return

    // Insert at the new position, preserving the visual order of the
    // selection: 'into' a CONTAINER appends at its end and 'before' stacks
    // up against the target, both in iteration order; 'after' — including
    // an 'into' on a LEAF row, which insertItemIntoTree degrades to an
    // insert-after — would REVERSE the batch (each insert lands right
    // behind the target), so those feed in reverse.
    const targetItem = findItemById(rootItems, targetId)
    const effectiveAfter = position === 'after' ||
      (position === 'into' && targetItem !== null && !isAnyFolder(targetItem) && !isScenario(targetItem))
    const insertionOrder = effectiveAfter ? [...removedItems].reverse() : removedItems
    let insertedAny = false
    for (const item of insertionOrder) {
      if (insertItemIntoTree(rootItems, item, targetId, position)) insertedAny = true
    }
    if (!insertedAny) return

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    refreshAllTabBreadcrumbs()

    // Moving an item edits the TREE, not any document, so none of the
    // per-document events fire — nothing marks a dirty unit, the autosave
    // is never armed, and the reorganisation stays in memory until some
    // unrelated edit happens to carry it to disk. Announce the moved item
    // as updated: that is the same signal every other mutation sends, so
    // it marks the project dirty and lets the autosave (or Ctrl+S) do the
    // writing, rather than forcing a write from here.
    // Announce the MOVED item with its new parent. A folder's own draft
    // excludes its children (each child is its own save unit), so
    // announcing the container changes nothing and leaves the project
    // "saved" — the save unit that genuinely moved is the item itself, and
    // `parentFolderId` is what carries the move.
    //
    // Scenarios are left to the host: they have no save-unit document
    // type of their own (announcing one under 'folder' would cleanse its
    // draft against the wrong shape and drop its nodes), and the app
    // already persists scenario edits through a debounced whole-file save
    // for exactly that reason.
    let movedAScenario = false
    for (const movedItem of removedItems) {
      if (isScenario(movedItem)) {
        movedAScenario = true
        continue
      }
      const movedParentId = findParentFolder(rootItems, movedItem.id)?.id
      const announcement = movedItemAnnouncement(movedItem)
      emitBothBuses(announcement.event, {
        id: movedItem.id,
        type: announcement.type,
        document: cloneForEventBus(movedItem),
        ...(movedParentId !== undefined ? { parentFolderId: movedParentId } : {})
      } as DocumentChangedPayload)
    }
    if (movedAScenario) onStructureChanged?.()
  }, [rootItems, setRootItems, refreshAllTabBreadcrumbs, onStructureChanged, canDropSelection])

  // Drop released on the sidebar's EMPTY AREA: move the dragged items to the
  // END of the root list. This is what makes "drag it back to the top level"
  // possible at all — every row is a container/sibling target, so the free
  // space below the tree is the only root-drop surface.
  const handleEmptyAreaDrop = useCallback((sources: ListViewItemEventPayload[]) => {
    const sourceIds = sources.map((sourceItem) => sourceItem.item.id)
    if (sourceIds.length === 0) return

    const removedItems: FolderItem[] = []
    for (const sourceId of sourceIds) {
      const removed = removeItemFromTree(rootItems, sourceId)
      if (removed) removedItems.push(removed)
    }
    if (removedItems.length === 0) return

    for (const item of removedItems) rootItems.push(item)

    setRootItems((prev) => [...prev])
    refreshAllTabBreadcrumbs()

    // Same dirty-marking contract as handleItemDrop: announce each moved
    // item (no parentFolderId — they now live at the root), scenarios via
    // the host's whole-file save.
    let movedAScenario = false
    for (const movedItem of removedItems) {
      if (isScenario(movedItem)) {
        movedAScenario = true
        continue
      }
      const announcement = movedItemAnnouncement(movedItem)
      emitBothBuses(announcement.event, {
        id: movedItem.id,
        type: announcement.type,
        document: cloneForEventBus(movedItem)
      } as DocumentChangedPayload)
    }
    if (movedAScenario) onStructureChanged?.()
  }, [rootItems, setRootItems, refreshAllTabBreadcrumbs, onStructureChanged])

  // Handle "Clone" context menu action. Works for any item — including a
  // ROOT-level folder / environment folder (cloneItemInTree inserts the deep
  // copy back into the root list when there's no parent).
  const handleCloneItem = useCallback((itemId: string) => {
    const clonedItem = cloneItemInTree(rootItems, itemId, t('sidebar.contextMenu.copySuffix', 'copy'))
    if (!clonedItem) return

    // `deepCloneItem` returns a plain, non-reactive POJO. Wrap the clone (and
    // its subtree) reactive and swap it into the tree in place so later edits
    // emit REQUEST_UPDATED / FOLDER_UPDATED like any other item.
    const { parent, index } = findItemWithParent(rootItems, clonedItem.id)
    const parentFolderId = parent && (isAnyFolder(parent) || isScenario(parent)) ? parent.id : undefined
    const reactiveClone = makeReactiveFolderItem(clonedItem, parentFolderId)
    if (index >= 0) {
      const siblings = parent ? (parent as { items: FolderItem[] }).items : rootItems
      if (siblings[index]?.id === reactiveClone.id) siblings[index] = reactiveClone
    }

    // Announce the creation. `cloneItemInTree` alone marks nothing dirty and
    // indexes nothing — this is what lights the git push badge (autosave) and
    // makes the clone findable in search immediately, like a normal create.
    emitClonedSubtreeCreated(reactiveClone, parentFolderId)

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    // Open the clone in the workbench, as a click on it would.
    const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, reactiveClone.id)
    if (breadcrumbs.length > 0) {
      if (isScenario(reactiveClone)) {
        openScenarioEditorTab(reactiveClone, breadcrumbs)
      } else if (isEnvironmentFolder(reactiveClone)) {
        openEnvironmentFolderTab(reactiveClone, breadcrumbs)
      } else if (isFolder(reactiveClone)) {
        openFolderTab(reactiveClone, breadcrumbs)
      } else if (isApiDesign(reactiveClone)) {
        openDesignTab(reactiveClone, breadcrumbs)
      } else if (isRequest(reactiveClone)) {
        const envs = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
        openAnyRequestTab(reactiveClone, breadcrumbs, envs)
      }
    }
  }, [rootItems, setRootItems, t, openFolderTab, openScenarioEditorTab, openEnvironmentFolderTab, openAnyRequestTab, openDesignTab])

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

    // Announce the deletion of every entity in the subtree, on BOTH buses,
    // BEFORE the tree mutation drops the nodes. Without this a sidebar
    // delete emitted nothing at all: the main-process search index never
    // dropped the entries (deleted items kept showing in search results)
    // and the renderer save-unit bridge never marked the project dirty (no
    // autosave after a delete). Each request/folder emits its own DELETED
    // so the search index — whose FOLDER_DELETED handler removes only the
    // named id, not descendants — clears the whole subtree. A scenario is
    // not itself indexed, but its descendant requests are, so we recurse
    // into scenarios and announce those. An env-folder's `environments`
    // (variables, not tree children — never reached via `.items`) get
    // their own ENVIRONMENT_DELETED per env + sub-env, so ContextService /
    // the search index drop them too instead of keeping a stale entry for
    // an env-folder id that no longer resolves to anything.
    const announceEnvironmentDeleted = (env: Environment, envFolderId: string, parentEnvironmentId: string | undefined): void => {
      emitBothBuses(DocumentEvents.ENVIRONMENT_DELETED, {
        id: env.id,
        type: 'environment',
        parentFolderId: envFolderId,
        ...(parentEnvironmentId !== undefined ? { parentEnvironmentId } : {})
      } as DocumentDeletedPayload)
      for (const sub of env.subEnvironments ?? []) announceEnvironmentDeleted(sub, envFolderId, env.id)
    }
    const announceDeleted = (node: FolderItem, parentId: string | undefined): void => {
      if (isRequest(node)) {
        emitBothBuses(DocumentEvents.REQUEST_DELETED, {
          id: node.id,
          type: 'request',
          ...(parentId !== undefined ? { parentFolderId: parentId } : {})
        } as DocumentDeletedPayload)
        return
      }
      if (isApiDesign(node)) {
        // A design is its own save unit: the DELETED event is what turns a
        // sidebar delete into a tombstone the next save commits.
        emitBothBuses(DocumentEvents.DESIGN_DELETED, {
          id: node.id,
          type: 'design',
          ...(parentId !== undefined ? { parentFolderId: parentId } : {})
        } as DocumentDeletedPayload)
        return
      }
      if (isAnyFolder(node) || isScenario(node)) {
        if (isAnyFolder(node)) {
          emitBothBuses(DocumentEvents.FOLDER_DELETED, {
            id: node.id,
            type: 'folder',
            ...(parentId !== undefined ? { parentFolderId: parentId } : {})
          } as DocumentDeletedPayload)
        }
        if (isEnvironmentFolder(node)) {
          for (const env of node.environments) announceEnvironmentDeleted(env, node.id, undefined)
        }
        for (const child of (node as FolderItem & { items?: FolderItem[] }).items ?? []) {
          announceDeleted(child, node.id)
        }
      }
    }
    const parentOf = (nodes: FolderItem[], childId: string): FolderItem | null => {
      for (const node of nodes) {
        if (!isAnyFolder(node) && !isScenario(node)) continue
        const kids = (node as FolderItem & { items?: FolderItem[] }).items ?? []
        if (kids.some((child) => child.id === childId)) return node
        const deeper = parentOf(kids, childId)
        if (deeper) return deeper
      }
      return null
    }
    const nodeToDelete = findItemById(rootItems, itemId)
    if (nodeToDelete) {
      announceDeleted(nodeToDelete, parentOf(rootItems, itemId)?.id)
    }

    // Remove the item from the tree (handles nested items — and root items,
    // which removeItemFromTree now splices from the root list itself).
    removeItemFromTree(rootItems, itemId)
    // Root-level rows are ALSO filtered inside the updater: when this delete
    // runs from a queued dialog callback (the container-delete walk), the
    // closure's `rootItems` can be one state-identity behind — a splice into
    // that stale array never reaches the live state, but `prev` always does.
    setRootItems((prev) => prev.filter((f) => f.id !== itemId))

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

    // Also update the workbench tab title and breadcrumbs, in EVERY group —
    // `mapAllWorkbenchTabs` recurses through split containers, which a
    // `prevTree.groups.map()` does not: a tab sitting in a split kept its old
    // name. The title is recomposed from the protocol registry, so renaming a
    // request refreshes its tab whatever its protocol.
    setWorkbenchTree((prevTree) => ({ ...prevTree, groups: mapAllWorkbenchTabs(prevTree.groups, (tab) => {
      const renamedBreadcrumbs = (restormTab: RestormEditorTab): RestormEditorTab['breadcrumbs'] =>
        restormTab.breadcrumbs?.map((bc) => (bc.id === itemId ? { ...bc, label: newName } : bc))

      if (tabBackingItemId(tab) === itemId) {
        const restormTab = tab as RestormEditorTab
        const renamed = { ...restormTab, breadcrumbs: renamedBreadcrumbs(restormTab), contentVersion: (restormTab.contentVersion ?? 0) + 1 }

        if ('request' in renamed) {
          const request = { ...renamed.request, name: newName }
          const title = requestTabTitle(request)
          // A request whose type the registry doesn't know keeps its old
          // label rather than losing it — the tree item is still renamed.
          if (title === null) return { ...renamed, request }
          return { ...renamed, request, title, titleString: title }
        }
        if ('folder' in renamed) {
          return { ...renamed, folder: { ...renamed.folder, name: newName }, title: newName, titleString: newName }
        }
        if ('scenario' in renamed) {
          return { ...renamed, scenario: { ...renamed.scenario, name: newName }, title: newName, titleString: newName }
        }
        if ('design' in renamed) {
          return { ...renamed, design: { ...renamed.design, name: newName }, title: newName, titleString: newName }
        }
        return renamed
      }

      // Not the renamed item, but it may sit UNDER it: refresh the crumb.
      const restormTab = tab as RestormEditorTab
      if (restormTab.breadcrumbs?.some((bc) => bc.id === itemId)) {
        return { ...restormTab, breadcrumbs: renamedBreadcrumbs(restormTab), contentVersion: (restormTab.contentVersion ?? 0) + 1 }
      }
      return tab
    }) }))

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
      case 'http-head': return 'New HEAD request'
      case 'http-options': return 'New OPTIONS request'
      case 'http-query': return 'New QUERY request'
      case 'http-server': return 'New HTTP server'
      case 'graphql': return 'New GraphQL request'
      case 'graphql-server': return 'New GraphQL server'
      case 'grpc': return 'New gRPC request'
      case 'grpc-server-stream': return 'New gRPC server-streaming request'
      case 'grpc-client-stream': return 'New gRPC client-streaming request'
      case 'grpc-bidi': return 'New gRPC bidirectional request'
      case 'grpc-server': return 'New gRPC server'
      case 'soap': return 'New SOAP request'
      case 'soap-server': return 'New SOAP server'
      case 'websocket': return 'New WebSocket request'
      case 'socketio': return 'New Socket.IO request'
      case 'socketio-server': return 'New Socket.IO server'
      case 'websocket-server': return 'New WebSocket server'
      case 'stomp': return 'New STOMP request'
      case 'mqtt': return 'New MQTT request'
      case 'mqtt-server': return 'New MQTT server'
      case 'sse': return 'New SSE request'
      case 'kafka-produce': return 'New Kafka produce request'
      case 'kafka-consume': return 'New Kafka consume request'
      case 'odata': return 'New OData request'
      case 'odata-server': return 'New OData server'
      case 'amqp': return 'New AMQP request'
      case 'redis': return 'New Redis request'
      case 'auth': return 'New auth request'
      case 'trpc': return 'New tRPC request'
      case 'scenario': return 'New scenario'
      case 'design': return t('design.newDesignName', 'New API design')
    }
  }, [t])

  /** Open a just-created sidebar item in inline rename, so the user can name
   * it straight away instead of hunting for F2 — every creation entry behaves
   * this way, whatever the kind. Deferred by a tick because the row only
   * mounts on the render that follows the tree update, and the ListView can't
   * put an edit field on a row it hasn't drawn yet.
   *
   * The item is fully created *before* this runs, so cancelling the rename
   * (Escape) leaves it in place under its default name — nothing half-built. */
  const startInlineRename = useCallback((itemId: string) => {
    setTimeout(() => {
      setSidebarEditingItemId(itemId)
    }, 0)
  }, [setSidebarEditingItemId])

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
    if (kind === 'design') {
      const design: import('../../../shared/types/collections').ApiDesign = {
        type: 'design',
        id,
        name,
        tags: [],
        info: { title: name, version: '1.0.0' },
        models: [],
        enums: [],
        routeGroups: []
      }
      const reactive = makeReactiveApiDesign(design)
      mountChild(reactive as unknown as FolderItem)
      pushedItem = reactive as unknown as FolderItem
      emitBothBuses(DocumentEvents.DESIGN_CREATED, {
        id: reactive.id,
        type: 'design',
        document: cloneForEventBus(reactive as unknown as FolderItem)
      } as DocumentChangedPayload)
    } else if (kind === 'scenario') {
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
      // BOTH buses: emitSync reaches the main-process search index +
      // ContextService; emitLocalSync reaches the renderer save-unit bridge
      // that marks the project dirty so autosave fires. emitSync alone
      // updated search but never triggered a save.
      emitBothBuses(DocumentEvents.FOLDER_CREATED, folderPayload)
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
                  kind === 'http-head' ? 'HEAD' :
                    kind === 'http-options' ? 'OPTIONS' :
                      kind === 'http-query' ? 'QUERY' :
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
      } else if (kind === 'stomp') {
        // STOMP CLIENT request (connects to a broker, e.g. the docker ActiveMQ
        // mock's STOMP-over-WebSocket port) — pre-seeded with one subscription
        // + a matching send destination so it is runnable the moment it is
        // created.
        built = new StompRequest({
          id,
          name,
          url: 'ws://localhost:61614',
          stompVersion: '1.2',
          subscriptions: [{ id: 'sub-0', destination: '/topic/demo', ackMode: 'auto' }],
          sendDestination: '/topic/demo',
          sendBody: '{\n  "message": "Hello from restorm"\n}'
        })
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
      } else if (kind === 'kafka-produce') {
        // Kafka has no persistent per-request connection: a "produce" child is
        // a one-shot request (connect -> send -> disconnect).
        built = new KafkaRequest({ id, name, mode: 'produce', url: 'localhost:9092' })
      } else if (kind === 'kafka-consume') {
        // A "consume" child defaults to a fresh consumer group starting at the
        // latest offset — the long-lived `kafkaConsume` node binds to it.
        built = new KafkaRequest({ id, name, mode: 'consume', url: 'localhost:9092', groupId: 'restorm-consumer' })
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
      } else if (kind === 'amqp') {
        // AMQP: one request type covers publish / subscribe / browse (picked
        // via the tab's mode selector) — default to publish against a local
        // broker, mirroring the MQTT client default.
        built = new AmqpRequest({ id, name, url: 'amqp://localhost:5672' })
      } else if (kind === 'redis') {
        // Command mode by default — the lower-friction starting point (no
        // channels to configure before the first run works).
        built = new RedisRequest({ id, name, url: 'redis://localhost:6379', mode: 'command', command: 'GET' })
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
      emitBothBuses(DocumentEvents.REQUEST_CREATED, createdPayload)
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
      } else if (isApiDesign(pushedItem)) {
        openDesignTab(pushedItem, breadcrumbs)
      } else if (isRequest(pushedItem)) {
        openAnyRequestTab(pushedItem, breadcrumbs, envs)
      }
      // Every kind this dispatcher can build lands in inline rename — folders,
      // scenarios and requests alike. Keeping it here rather than per-kind is
      // what makes a future request type inherit the behaviour for free.
      startInlineRename(id)
    }
    return id
  }, [rootItems, setRootItems, setExpandedIds, setSelectedItemId, openFolderTab, openScenarioEditorTab, openAnyRequestTab, openDesignTab, defaultNameFor, startInlineRename])

  const handleCreateRootEnvironmentFolder = useCallback(() => {
    const newFolder: EnvironmentFolder = {
      id: generateUniqueId(),
      name: t('sidebar.newEnvironmentFolder'),
      folderType: 'environment',
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
    emitBothBuses(DocumentEvents.FOLDER_CREATED, {
      id: newFolder.id,
      type: 'folder',
      document: cloneForEventBus(newFolder)
    } as DocumentChangedPayload)
    const breadcrumbs = [{ id: newFolder.id, label: newFolder.name, icon: getFolderIcon(newFolder) }]
    openEnvironmentFolderTab(newFolder, breadcrumbs)
    startInlineRename(newFolder.id)
  }, [setRootItems, setSelectedItemId, startInlineRename, openEnvironmentFolderTab, t])

  return {
    handleItemDrop,
    canDropSelection,
    handleEmptyAreaDrop,
    handleCloneItem,
    handleCreateRootEnvironmentFolder,
    handleAddChildItem,
    handleDeleteItem,
    confirmDelete,
    cancelDelete,
    handleSidebarItemRename
  }
}
