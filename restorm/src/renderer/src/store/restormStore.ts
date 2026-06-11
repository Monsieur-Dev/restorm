/**
 * Restorm Store - Centralized state management using Zustand
 * 
 * Manages:
 * - Collections (folders, requests, environments)
 * - Editing state (which item is being edited)
 * - Event source tracking (to prevent feedback loops)
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { EnvironmentFolder, FolderItem, Environment, Request, Folder } from '../../../shared/types/collections'
import { isAnyFolder, isEnvironmentFolder, isRequest } from '../../../shared/types/collections'
import { cloneForEventBus } from '../utils/cloneForEventBus'

// ============================================================================
// Types
// ============================================================================

/** Event source identifier for tracking where changes originate */
export type EventSource = 'user' | 'remote' | 'file-load' | 'graphql' | 'mcp'

/** Editing state for an item */
export interface EditingState {
  /** ID of the item being edited */
  itemId: string
  /** Property being edited (optional) */
  property?: string | undefined
  /** Timestamp when editing started */
  startedAt: number
}

/** Store state interface */
export interface RestormState {
  // Collections
  collections: EnvironmentFolder[]
  
  // Editing state
  editingState: EditingState | null
  focusedItemId: string | null
  
  // Event source tracking
  currentEventSource: EventSource
  
  // Actions
  setCollections: (collections: EnvironmentFolder[], source?: EventSource) => void
  updateCollection: (id: string, updates: Partial<EnvironmentFolder>, source?: EventSource) => void
  
  // Item operations
  updateItem: (id: string, updates: Partial<FolderItem>, source?: EventSource) => void
  deleteItem: (id: string, source?: EventSource) => void
  moveItem: (id: string, newParentId: string, index: number, source?: EventSource) => void
  
  // Environment operations
  updateEnvironment: (id: string, updates: Partial<Environment>, source?: EventSource) => void
  deleteEnvironment: (id: string, source?: EventSource) => void
  
  // Editing state
  startEditing: (itemId: string, property?: string) => void
  stopEditing: () => void
  setFocusedItem: (itemId: string | null) => void
  isEditing: (itemId: string) => boolean
  
  // Event source
  setEventSource: (source: EventSource) => void
  shouldIgnoreEvent: (itemId: string, source: EventSource) => boolean
  
  // Helpers
  findItemById: (id: string) => FolderItem | null
  findEnvironmentById: (id: string) => Environment | null
  findParentFolder: (itemId: string) => Folder | EnvironmentFolder | null
  findOwningEnvironmentFolder: (itemId: string) => EnvironmentFolder | null
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Find an item by ID in the collections tree */
function findItemInTree(collections: EnvironmentFolder[], id: string): FolderItem | null {
  for (const collection of collections) {
    if (collection.id === id) return collection
    
    const found = findInFolder(collection.items, id)
    if (found) return found
  }
  return null
}

/** Recursively find item in folder items */
function findInFolder(items: FolderItem[], id: string): FolderItem | null {
  for (const item of items) {
    if (item.id === id) return item
    if (isAnyFolder(item)) {
      const found = findInFolder(item.items, id)
      if (found) return found
    }
  }
  return null
}

/** Find an environment by ID */
function findEnvironmentInTree(collections: EnvironmentFolder[], id: string): Environment | null {
  for (const collection of collections) {
    if (!isEnvironmentFolder(collection as FolderItem)) continue
    
    for (const env of collection.environments) {
      if (env.id === id) return env
      const found = findInSubEnvironments(env.subEnvironments, id)
      if (found) return found
    }
  }
  return null
}

/** Recursively find environment in sub-environments */
function findInSubEnvironments(subEnvs: Environment[] | undefined, id: string): Environment | null {
  if (!subEnvs) return null
  for (const env of subEnvs) {
    if (env.id === id) return env
    const found = findInSubEnvironments(env.subEnvironments, id)
    if (found) return found
  }
  return null
}

/** Find parent folder of an item */
function findParentFolderInTree(collections: EnvironmentFolder[], itemId: string): Folder | EnvironmentFolder | null {
  for (const collection of collections) {
    const found = findParentInFolder(collection, itemId)
    if (found) return found
  }
  return null
}

/**
 * Walk down the tree looking for `itemId`, keeping track of the closest
 * EnvironmentFolder ancestor on the way. When found, return that ancestor —
 * that's the folder that owns the `apiDocumentation` used to compile docs for
 * the item.
 *
 * Returns `null` when the id isn't in the tree.
 */
function findOwningEnvironmentFolderInTree(
  collections: EnvironmentFolder[],
  itemId: string
): EnvironmentFolder | null {
  function walk(
    items: readonly FolderItem[],
    closestEnv: EnvironmentFolder | null
  ): EnvironmentFolder | null {
    for (const item of items) {
      if (item.id === itemId) return closestEnv
      if (!isAnyFolder(item)) continue
      const nextClosest = isEnvironmentFolder(item) ? item : closestEnv
      const found = walk(item.items, nextClosest)
      if (found) return found
    }
    return null
  }

  for (const collection of collections) {
    if (collection.id === itemId) return collection
    const found = walk(collection.items, collection)
    if (found) return found
  }
  return null
}

/** Recursively find parent folder */
function findParentInFolder(folder: Folder | EnvironmentFolder, itemId: string): Folder | EnvironmentFolder | null {
  for (const item of folder.items) {
    if (item.id === itemId) return folder
    if (isAnyFolder(item)) {
      const found = findParentInFolder(item, itemId)
      if (found) return found
    }
  }
  return null
}

/** Update an item in the tree immutably */
function updateItemInTree(collections: EnvironmentFolder[], id: string, updates: Partial<FolderItem>): EnvironmentFolder[] {
  return collections.map(collection => {
    if (collection.id === id) {
      return { ...collection, ...updates } as EnvironmentFolder
    }
    return {
      ...collection,
      items: updateItemsInFolder(collection.items, id, updates)
    }
  })
}

/** Recursively update items in folder */
function updateItemsInFolder(items: FolderItem[], id: string, updates: Partial<FolderItem>): FolderItem[] {
  return items.map(item => {
    if (item.id === id) {
      if (isRequest(item)) {
        return { ...item, ...updates } as Request
      }
      return { ...item, ...updates } as Folder
    }
    if (isAnyFolder(item)) {
      return {
        ...item,
        items: updateItemsInFolder(item.items, id, updates)
      }
    }
    return item
  })
}

/** Delete an item from the tree immutably */
function deleteItemFromTree(collections: EnvironmentFolder[], id: string): EnvironmentFolder[] {
  return collections.map(collection => ({
    ...collection,
    items: deleteItemFromFolder(collection.items, id)
  })).filter(c => c.id !== id)
}

/** Recursively delete item from folder */
function deleteItemFromFolder(items: FolderItem[], id: string): FolderItem[] {
  return items
    .filter(item => item.id !== id)
    .map(item => {
      if (isAnyFolder(item)) {
        return {
          ...item,
          items: deleteItemFromFolder(item.items, id)
        }
      }
      return item
    })
}

// ============================================================================
// Store
// ============================================================================

export const useRestormStore = create<RestormState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    collections: [],
    editingState: null,
    focusedItemId: null,
    currentEventSource: 'user',
    
    // Set collections
    setCollections: (collections, source = 'user') => {
      set({ collections, currentEventSource: source })
      // Skip the main-side mirror when MCP drove the change — main IS
      // the source in that case (the MCP write tool already mutated
      // CollectionStore + broadcast `mcp:tree-replace`). Roundtripping
      // the same tree back as plain JSON would clobber main's class
      // instances and break the next mutation's `toPlainObject()`
      // call — see CollectionStore.reifyItem for the symmetric guard.
      if (source === 'mcp') return
      // Mirror the tree onto the main-side CollectionStore so the
      // apiUpdate apply / preview orchestrators can look up folders
      // by id. Without this sync the main-side store stays empty
      // and every "Refresh from source" fails with "folder not
      // found". Fire-and-forget — the handler is idempotent and the
      // renderer doesn't gate on the round-trip.
      const api = (window as unknown as { restorm?: { apiUpdate?: { syncCollections?: (c: unknown[]) => Promise<void> } } }).restorm?.apiUpdate
      if (api?.syncCollections) {
        // Strip reactive proxies before sending over IPC — they
        // serialize fine but the receiving side wants plain objects.
        // `cloneForEventBus` instead of `JSON.parse(JSON.stringify(...))`
        // so `SecretValue.toJSON()` doesn't get called along the way
        // — main needs the plaintext to resolve handlebars + to write
        // the `.restorm.env` sidecar correctly on the next save.
        void api.syncCollections(cloneForEventBus(collections) as unknown[])
      }
    },
    
    // Update a collection
    updateCollection: (id, updates, source = 'user') => {
      set(state => ({
        collections: state.collections.map(c => 
          c.id === id ? { ...c, ...updates } : c
        ),
        currentEventSource: source
      }))
    },
    
    // Update an item
    updateItem: (id, updates, source = 'user') => {
      set(state => ({
        collections: updateItemInTree(state.collections, id, updates),
        currentEventSource: source
      }))
    },
    
    // Delete an item
    deleteItem: (id, source = 'user') => {
      set(state => ({
        collections: deleteItemFromTree(state.collections, id),
        currentEventSource: source
      }))
    },
    
    // Move an item
    moveItem: (id, newParentId, index, source = 'user') => {
      const state = get()
      const item = findItemInTree(state.collections, id)
      if (!item) return
      
      // Remove from current position
      let collections = deleteItemFromTree(state.collections, id)
      
      // Add to new position
      collections = collections.map(collection => {
        if (collection.id === newParentId) {
          const newItems = [...collection.items]
          newItems.splice(index, 0, item)
          return { ...collection, items: newItems }
        }
        return {
          ...collection,
          items: addItemToFolder(collection.items, newParentId, item, index)
        }
      })
      
      set({ collections, currentEventSource: source })
    },
    
    // Update an environment
    updateEnvironment: (id, updates, source = 'user') => {
      set(state => ({
        collections: state.collections.map(collection => {
          if (!isEnvironmentFolder(collection as FolderItem)) return collection
          return {
            ...collection,
            environments: updateEnvironmentInList(collection.environments, id, updates)
          }
        }),
        currentEventSource: source
      }))
    },
    
    // Delete an environment
    deleteEnvironment: (id, source = 'user') => {
      set(state => ({
        collections: state.collections.map(collection => {
          if (!isEnvironmentFolder(collection as FolderItem)) return collection
          return {
            ...collection,
            environments: deleteEnvironmentFromList(collection.environments, id)
          }
        }),
        currentEventSource: source
      }))
    },
    
    // Start editing
    startEditing: (itemId, property) => {
      set({
        editingState: {
          itemId,
          property,
          startedAt: Date.now()
        }
      })
    },
    
    // Stop editing
    stopEditing: () => {
      set({ editingState: null })
    },
    
    // Set focused item
    setFocusedItem: (itemId) => {
      set({ focusedItemId: itemId })
    },
    
    // Check if item is being edited
    isEditing: (itemId) => {
      return get().editingState?.itemId === itemId
    },
    
    // Set event source
    setEventSource: (source) => {
      set({ currentEventSource: source })
    },
    
    // Check if event should be ignored (to prevent feedback loops)
    shouldIgnoreEvent: (itemId, source) => {
      const state = get()
      
      // If user is editing this item, ignore remote events
      if (state.editingState?.itemId === itemId && source !== 'user') {
        return true
      }
      
      // If this item is focused and event is from graphql subscription, ignore
      if (state.focusedItemId === itemId && source === 'graphql') {
        return true
      }
      
      return false
    },
    
    // Find item by ID
    findItemById: (id) => {
      return findItemInTree(get().collections, id)
    },
    
    // Find environment by ID
    findEnvironmentById: (id) => {
      return findEnvironmentInTree(get().collections, id)
    },
    
    // Find parent folder
    findParentFolder: (itemId) => {
      return findParentFolderInTree(get().collections, itemId)
    },

    // Find the nearest ancestor EnvironmentFolder for an item (carries the
    // root `apiDocumentation` used by the on-the-fly docs compiler).
    findOwningEnvironmentFolder: (itemId) => {
      return findOwningEnvironmentFolderInTree(get().collections, itemId)
    }
  }))
)

// ============================================================================
// Helper for adding item to folder
// ============================================================================

function addItemToFolder(items: FolderItem[], parentId: string, newItem: FolderItem, index: number): FolderItem[] {
  return items.map(item => {
    if (item.id === parentId && isAnyFolder(item)) {
      const newItems = [...item.items]
      newItems.splice(index, 0, newItem)
      return { ...item, items: newItems }
    }
    if (isAnyFolder(item)) {
      return {
        ...item,
        items: addItemToFolder(item.items, parentId, newItem, index)
      }
    }
    return item
  })
}

function updateEnvironmentInList(envs: Environment[], id: string, updates: Partial<Environment>): Environment[] {
  return envs.map(env => {
    if (env.id === id) {
      return { ...env, ...updates }
    }
    if (env.subEnvironments) {
      return {
        ...env,
        subEnvironments: updateEnvironmentInList(env.subEnvironments, id, updates)
      }
    }
    return env
  })
}

function deleteEnvironmentFromList(envs: Environment[], id: string): Environment[] {
  return envs
    .filter(env => env.id !== id)
    .map(env => {
      if (env.subEnvironments) {
        return {
          ...env,
          subEnvironments: deleteEnvironmentFromList(env.subEnvironments, id)
        }
      }
      return env
    })
}

// ============================================================================
// Selectors
// ============================================================================

/** Select all collections */
export const selectCollections = (state: RestormState): EnvironmentFolder[] => state.collections

/** Select editing state */
export const selectEditingState = (state: RestormState): EditingState | null => state.editingState

/** Select focused item ID */
export const selectFocusedItemId = (state: RestormState): string | null => state.focusedItemId

/** Select current event source */
export const selectEventSource = (state: RestormState): EventSource => state.currentEventSource
