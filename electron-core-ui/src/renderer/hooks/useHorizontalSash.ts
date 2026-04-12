/**
 * useHorizontalSash - Hook for managing horizontal sash (resizable panel)
 *
 * Provides state and handlers for a horizontally-oriented resizable panel
 * with min/max constraints and optional persistence.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { SashEvent, IHorizontalSashLayoutProvider } from '../components'
import type { Sash } from '../components/Sash/types'

export interface UseHorizontalSashOptions {
  /** Initial height of the panel */
  initialHeight: number
  /** Minimum height allowed */
  minHeight: number
  /** Minimum height for the bottom side (optional, for calculating max height) */
  minBottomHeight?: number
  /** Storage key for persisting height (optional) */
  storageKey?: string
}

export interface UseHorizontalSashReturn {
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Current height of the panel */
  height: number
  /** Width of the container (from ResizeObserver) */
  containerWidth: number
  /** Layout provider for the Sash component */
  layoutProvider: IHorizontalSashLayoutProvider
  /** Handler for sash start event */
  handleSashStart: (event: SashEvent) => void
  /** Handler for sash change event */
  handleSashChange: (event: SashEvent) => void
}

export function useHorizontalSash(options: UseHorizontalSashOptions): UseHorizontalSashReturn {
  const { initialHeight, minHeight, minBottomHeight = 100, storageKey } = options

  // Load persisted height if storageKey is provided
  const loadPersistedHeight = useCallback((): number => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey)
        if (stored) {
          const parsed = parseInt(stored, 10)
          if (!isNaN(parsed) && parsed >= minHeight) {
            return parsed
          }
        }
      } catch {
        // Ignore errors
      }
    }
    return initialHeight
  }, [storageKey, initialHeight, minHeight])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number>(loadPersistedHeight)
  const [containerWidth, setContainerWidth] = useState<number>(0)
  const sashStartHeightRef = useRef<number>(height)

  // Persist height when it changes
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, height.toString())
      } catch {
        // Ignore errors
      }
    }
  }, [height, storageKey])

  const layoutProvider: IHorizontalSashLayoutProvider = useMemo(
    () => ({
      getHorizontalSashTop: (_sash: Sash) => height,
      getHorizontalSashLeft: (_sash: Sash) => 0,
      getHorizontalSashWidth: (_sash: Sash) => containerWidth
    }),
    [height, containerWidth]
  )

  const handleSashStart = useCallback(
    (_event: SashEvent): void => {
      sashStartHeightRef.current = height
    },
    [height]
  )

  const handleSashChange = useCallback((event: SashEvent): void => {
    if (!containerRef.current) return

    const delta = event.currentY - event.startY
    const containerHeight = containerRef.current.clientHeight
    const min = minHeight
    const max = Math.max(min, containerHeight - minBottomHeight)
    const start = sashStartHeightRef.current
    const next = Math.min(max, Math.max(min, start + delta))

    setHeight(next)
  }, [minHeight, minBottomHeight])

  // Observe container size changes
  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const observer = new ResizeObserver(() => {
      const el = containerRef.current
      if (el) {
        setContainerWidth(el.clientWidth)
      }
    })
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
    }
  }, [])

  return {
    containerRef,
    height,
    containerWidth,
    layoutProvider,
    handleSashStart,
    handleSashChange
  }
}
