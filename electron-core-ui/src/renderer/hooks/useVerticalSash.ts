/**
 * useVerticalSash - Hook for managing vertical sash (resizable panel)
 *
 * Provides state and handlers for a vertically-oriented resizable panel
 * with min/max constraints and optional persistence.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { SashEvent } from '../components'

export interface IVerticalSashLayoutProvider {
  getVerticalSashLeft: () => number
  getVerticalSashTop: () => number
  getVerticalSashHeight: () => number
}

export interface UseVerticalSashOptions {
  /** Initial width of the panel */
  initialWidth: number
  /** Minimum width allowed */
  minWidth: number
  /** Minimum width for the right side (optional, for calculating max width) */
  minRightWidth?: number
  /** Storage key for persisting width (optional) */
  storageKey?: string
}

export interface UseVerticalSashReturn {
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Current width of the panel */
  width: number
  /** Height of the container (from ResizeObserver) */
  containerHeight: number
  /** Layout provider for the Sash component */
  layoutProvider: IVerticalSashLayoutProvider
  /** Handler for sash start event */
  handleSashStart: (event: SashEvent) => void
  /** Handler for sash change event */
  handleSashChange: (event: SashEvent) => void
}

export function useVerticalSash(options: UseVerticalSashOptions): UseVerticalSashReturn {
  const { initialWidth, minWidth, minRightWidth = 240, storageKey } = options

  // Load persisted width if storageKey is provided
  const loadPersistedWidth = useCallback((): number => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey)
        if (stored) {
          const parsed = parseInt(stored, 10)
          if (!isNaN(parsed) && parsed >= minWidth) {
            return parsed
          }
        }
      } catch {
        // Ignore errors
      }
    }
    return initialWidth
  }, [storageKey, initialWidth, minWidth])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number>(loadPersistedWidth)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const sashStartWidthRef = useRef<number>(width)

  // Persist width when it changes
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, width.toString())
      } catch {
        // Ignore errors
      }
    }
  }, [width, storageKey])

  const layoutProvider: IVerticalSashLayoutProvider = useMemo(
    () => ({
      getVerticalSashLeft: () => width,
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => containerHeight
    }),
    [width, containerHeight]
  )

  const handleSashStart = useCallback(
    (_event: SashEvent): void => {
      sashStartWidthRef.current = width
    },
    [width]
  )

  const handleSashChange = useCallback((event: SashEvent): void => {
    if (!containerRef.current) return

    const delta = event.currentX - event.startX
    const containerWidth = containerRef.current.clientWidth
    const min = minWidth
    const max = Math.max(min, containerWidth - minRightWidth)
    const start = sashStartWidthRef.current
    const next = Math.min(max, Math.max(min, start + delta))

    setWidth(next)
  }, [minWidth, minRightWidth])

  // Observe container size changes
  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const observer = new ResizeObserver(() => {
      const el = containerRef.current
      if (el) {
        setContainerHeight(el.clientHeight)
      }
    })
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
    }
  }, [])

  return {
    containerRef,
    width,
    containerHeight,
    layoutProvider,
    handleSashStart,
    handleSashChange
  }
}
