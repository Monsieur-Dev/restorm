/**
 * Hook for managing the Ctrl+Tab tab switching overlay
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { TabSwitcherItem } from 'electron-core-ui/renderer'

export interface UseTabSwitcherOptions {
  enabled: boolean
  onTabSelect: (key: string) => void
  /** Build the items to display in the overlay. Called when overlay opens. */
  buildItems: () => TabSwitcherItem[]
}

export interface UseTabSwitcherReturn {
  isOpen: boolean
  items: TabSwitcherItem[]
  selectedIndex: number
  handleClose: () => void
  handleSelect: (item: TabSwitcherItem) => void
}

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac')

export function useTabSwitcher(options: UseTabSwitcherOptions): UseTabSwitcherReturn {
  const { enabled, onTabSelect } = options

  const [isOpen, setIsOpen] = useState(false)
  const [items, setItems] = useState<TabSwitcherItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Refs to avoid stale closures in event listeners
  const isOpenRef = useRef(isOpen)
  const itemsRef = useRef(items)
  const selectedIndexRef = useRef(selectedIndex)
  const onTabSelectRef = useRef(onTabSelect)
  const buildItemsRef = useRef(options.buildItems)

  useEffect(() => { isOpenRef.current = isOpen }, [isOpen])
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { selectedIndexRef.current = selectedIndex }, [selectedIndex])
  useEffect(() => { onTabSelectRef.current = onTabSelect }, [onTabSelect])
  useEffect(() => { buildItemsRef.current = options.buildItems }, [options.buildItems])

  const close = useCallback(() => {
    setIsOpen(false)
    setItems([])
    setSelectedIndex(0)
  }, [])

  const handleSelect = useCallback((item: TabSwitcherItem) => {
    onTabSelectRef.current(item.id)
    close()
  }, [close])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Ctrl+Tab or Ctrl+Shift+Tab
      if (modKey && e.key === 'Tab') {
        e.preventDefault()

        if (!isOpenRef.current) {
          const builtItems = buildItemsRef.current()
          if (builtItems.length < 2) return

          setItems(builtItems)
          setIsOpen(true)

          if (e.shiftKey) {
            // Shift+Tab goes to last item
            setSelectedIndex(builtItems.length - 1)
          } else {
            // Tab goes to second item (previous tab)
            setSelectedIndex(1)
          }
        } else {
          // Already open - cycle through items
          const count = itemsRef.current.length
          if (count === 0) return

          if (e.shiftKey) {
            setSelectedIndex((prev) => (prev - 1 + count) % count)
          } else {
            setSelectedIndex((prev) => (prev + 1) % count)
          }
        }
        return
      }

      // Escape while open: close without selecting
      if (e.key === 'Escape' && isOpenRef.current) {
        e.preventDefault()
        close()
      }
    }

    const handleKeyUp = (e: KeyboardEvent): void => {
      // When the modifier key is released and overlay is open, select the current item
      const relevantKey = isMac ? 'Meta' : 'Control'
      if (e.key === relevantKey && isOpenRef.current) {
        const currentItems = itemsRef.current
        const idx = selectedIndexRef.current
        const item = currentItems[idx]
        if (item) {
          onTabSelectRef.current(item.id)
        }
        close()
      }
    }

    const handleBlur = (): void => {
      if (isOpenRef.current) {
        close()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled, close])

  if (!enabled) {
    return {
      isOpen: false,
      items: [],
      selectedIndex: 0,
      handleClose: close,
      handleSelect
    }
  }

  return {
    isOpen,
    items,
    selectedIndex,
    handleClose: close,
    handleSelect
  }
}
