/**
 * useModalState - Hook for managing multiple modal states
 *
 * Simplifies managing multiple modals in an application with optional
 * data passing between modals and the rest of the app.
 */

import { useState, useCallback } from 'react'

export interface ModalState<T> {
  isOpen: boolean
  data?: T
}

export interface UseModalStateReturn<K extends string, T = unknown> {
  /** Check if a modal is open */
  isOpen: (name: K) => boolean
  /** Open a modal, optionally with data */
  open: (name: K, data?: T) => void
  /** Close a modal */
  close: (name: K) => void
  /** Toggle a modal's open state */
  toggle: (name: K) => void
  /** Get data associated with a modal */
  getData: (name: K) => T | undefined
  /** Close all modals */
  closeAll: () => void
}

/**
 * Hook for managing the state of multiple modals
 *
 * @example
 * ```typescript
 * const modals = useModalState(['save', 'delete', 'settings'] as const)
 *
 * // Open a modal
 * modals.open('save')
 *
 * // Open with data
 * modals.open('delete', { itemId: '123', itemName: 'MyFile' })
 *
 * // Check if open
 * if (modals.isOpen('save')) { ... }
 *
 * // Get data
 * const deleteData = modals.getData('delete')
 *
 * // Close
 * modals.close('save')
 * ```
 */
export function useModalState<K extends string, T = unknown>(
  modalNames: readonly K[]
): UseModalStateReturn<K, T> {
  const [modals, setModals] = useState<Map<K, ModalState<T>>>(() => {
    const initial = new Map<K, ModalState<T>>()
    for (const name of modalNames) {
      initial.set(name, { isOpen: false })
    }
    return initial
  })

  const isOpen = useCallback((name: K): boolean => {
    return modals.get(name)?.isOpen ?? false
  }, [modals])

  const open = useCallback((name: K, data?: T): void => {
    setModals(prev => {
      const next = new Map(prev)
      const modalState: ModalState<T> = { isOpen: true }
      if (data !== undefined) {
        modalState.data = data
      }
      next.set(name, modalState)
      return next
    })
  }, [])

  const close = useCallback((name: K): void => {
    setModals(prev => {
      const next = new Map(prev)
      const current = next.get(name)
      if (current) {
        next.set(name, { ...current, isOpen: false })
      }
      return next
    })
  }, [])

  const toggle = useCallback((name: K): void => {
    setModals(prev => {
      const next = new Map(prev)
      const current = next.get(name)
      if (current) {
        next.set(name, { ...current, isOpen: !current.isOpen })
      }
      return next
    })
  }, [])

  const getData = useCallback((name: K): T | undefined => {
    return modals.get(name)?.data
  }, [modals])

  const closeAll = useCallback((): void => {
    setModals(prev => {
      const next = new Map(prev)
      for (const [name, state] of next) {
        next.set(name, { ...state, isOpen: false })
      }
      return next
    })
  }, [])

  return {
    isOpen,
    open,
    close,
    toggle,
    getData,
    closeAll
  }
}
