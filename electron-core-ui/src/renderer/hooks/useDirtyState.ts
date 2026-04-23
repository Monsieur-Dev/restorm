/**
 * useDirtyState - Hook for tracking dirty state per item/tab
 *
 * Useful for applications with multiple documents or tabs where each
 * can be individually dirty (modified but not saved).
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { logger } from '../services'

export interface DirtyStateItem {
  id: string
  checksum: string
  originalChecksum: string
  isDirty: boolean
}

export interface DirtyStateHook {
  /** Check if a specific item is dirty */
  isItemDirty: (id: string) => boolean
  /** Check if any item is dirty */
  hasAnyDirty: boolean
  /** Get all dirty item IDs */
  dirtyItemIds: string[]
  /** Register an item with its initial checksum */
  registerItem: (id: string, checksum: string) => void
  /** Update an item's current checksum (marks as dirty if different from original) */
  updateItemChecksum: (id: string, checksum: string) => void
  /** Mark an item as saved (updates original checksum to current) */
  markItemSaved: (id: string) => void
  /** Mark all items as saved */
  markAllSaved: () => void
  /** Remove an item from tracking */
  removeItem: (id: string) => void
  /** Clear all tracking */
  clear: () => void
}

/**
 * Compute a simple hash checksum of an object
 */
function sortedReplacer(key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(raw).sort()) {
      // Skip runtime-only IDs on KeyValue-like objects (they have `key` +
      // `value` properties). These IDs are assigned lazily by the UI table
      // and must not affect the checksum.
      if (k === 'id' && 'key' in raw && 'value' in raw) continue
      sorted[k] = raw[k]
    }
    return sorted
  }
  return value
  void key
}

export function computeChecksum(data: unknown): string {
  try {
    const str = JSON.stringify(data, sortedReplacer)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(36)
  } catch {
    return ''
  }
}

export function useDirtyState(): DirtyStateHook {
  const [items, setItems] = useState<Map<string, DirtyStateItem>>(new Map())
  const itemsRef = useRef(items)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const isItemDirty = useCallback((id: string): boolean => {
    return itemsRef.current.get(id)?.isDirty ?? false
  }, [])

  const hasAnyDirty = useMemo(() => {
    return Array.from(items.values()).some(item => item.isDirty)
  }, [items])

  const dirtyItemIds = useMemo(() => {
    return Array.from(items.entries())
      .filter(([, item]) => item.isDirty)
      .map(([id]) => id)
  }, [items])

  const registerItem = useCallback((id: string, checksum: string) => {
    setItems(prev => {
      const next = new Map(prev)
      next.set(id, {
        id,
        checksum,
        originalChecksum: checksum,
        isDirty: false
      })
      return next
    })
    logger.debug('[DirtyState] Item registered', { id })
  }, [])

  const updateItemChecksum = useCallback((id: string, checksum: string) => {
    setItems(prev => {
      const item = prev.get(id)
      // [TYPING-DEBUG] OYO-253 — will revert.
      ;(globalThis as { window?: { console: Console } }).window?.console.info(
        '[TYPING-DEBUG] updateItemChecksum',
        { id, hasItem: !!item, prevChecksum: item?.checksum, newChecksum: checksum }
      )
      if (!item) return prev

      const isDirty = checksum !== item.originalChecksum
      if (item.checksum === checksum && item.isDirty === isDirty) {
        ;(globalThis as { window?: { console: Console } }).window?.console.info(
          '[TYPING-DEBUG] updateItemChecksum bail (no diff)', { id }
        )
        return prev
      }

      ;(globalThis as { window?: { console: Console } }).window?.console.info(
        '[TYPING-DEBUG] updateItemChecksum setItems fires', { id }
      )
      const next = new Map(prev)
      next.set(id, {
        ...item,
        checksum,
        isDirty
      })
      return next
    })
  }, [])

  const markItemSaved = useCallback((id: string) => {
    setItems(prev => {
      const item = prev.get(id)
      if (!item) return prev

      const next = new Map(prev)
      next.set(id, {
        ...item,
        originalChecksum: item.checksum,
        isDirty: false
      })
      logger.debug('[DirtyState] Item marked as saved', { id })
      return next
    })
  }, [])

  const markAllSaved = useCallback(() => {
    setItems(prev => {
      const next = new Map(prev)
      for (const [id, item] of next) {
        next.set(id, {
          ...item,
          originalChecksum: item.checksum,
          isDirty: false
        })
      }
      logger.debug('[DirtyState] All items marked as saved')
      return next
    })
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setItems(new Map())
    logger.debug('[DirtyState] Cleared all tracking')
  }, [])

  return {
    isItemDirty,
    hasAnyDirty,
    dirtyItemIds,
    registerItem,
    updateItemChecksum,
    markItemSaved,
    markAllSaved,
    removeItem,
    clear
  }
}
