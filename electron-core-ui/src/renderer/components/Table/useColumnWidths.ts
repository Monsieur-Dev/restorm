import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Shape of a column as consumed by the widths hook. Matches the public
 * TableColumn interface but narrowed to just the width-relevant fields.
 */
export interface WidthColumnDef {
  id: string
  /** Fixed width (px). Takes precedence over resizable. */
  width?: number | undefined
  resizable?: boolean | undefined
  defaultWidth?: number | undefined
  minWidth?: number | undefined
  maxWidth?: number | undefined
}

const DEFAULT_MIN_WIDTH = 40

/** @internal Exposed for tests. */
export function storageKey(tableId: string): string {
  return `ecu:table:${tableId}:column-widths`
}

/** @internal Exposed for tests. */
export function loadFromStorage(tableId: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(storageKey(tableId))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        result[key] = value
      }
    }
    return result
  } catch {
    return null
  }
}

function writeToStorage(tableId: string, widths: Record<string, number>): void {
  try {
    localStorage.setItem(storageKey(tableId), JSON.stringify(widths))
  } catch {
    // quota exceeded or serialization failure — silently ignore
  }
}

function removeFromStorage(tableId: string): void {
  try {
    localStorage.removeItem(storageKey(tableId))
  } catch {
    // ignore
  }
}

/**
 * Returns the computed initial width map for the given columns, merging
 * defaults with any persisted values for columns that still exist.
 *
 * For resizable columns without a `defaultWidth` and no persisted value,
 * the returned map leaves them *undefined* — callers must treat absence
 * as "share remaining space equally among the peers that are also
 * undefined".
 */
/** @internal Exposed for tests. */
export function buildInitialWidths(columns: WidthColumnDef[], persisted: Record<string, number> | null): Record<string, number | undefined> {
  const validIds = new Set(columns.map((c) => c.id))
  const result: Record<string, number | undefined> = {}
  for (const col of columns) {
    if (col.width !== undefined) {
      result[col.id] = col.width
      continue
    }
    const stored = persisted && validIds.has(col.id) ? persisted[col.id] : undefined
    if (stored !== undefined) {
      const clamped = clamp(stored, col.minWidth ?? DEFAULT_MIN_WIDTH, col.maxWidth)
      result[col.id] = clamped
      continue
    }
    if (col.defaultWidth !== undefined) {
      result[col.id] = col.defaultWidth
      continue
    }
    result[col.id] = undefined
  }
  return result
}

/** @internal Exposed for tests. */
export function clampWidth(value: number, min: number, max: number | undefined): number {
  return clamp(value, min, max)
}

function clamp(value: number, min: number, max: number | undefined): number {
  if (value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

export interface UseColumnWidthsResult {
  /**
   * Current width per column id. Value is `undefined` for resizable
   * columns without a default that should share remaining space — the
   * caller renders them without an explicit width and lets the table
   * layout distribute the leftover space equally.
   */
  widths: Record<string, number | undefined>
  /** Set a single column's width. Clamped and persisted (debounced). */
  setWidth: (id: string, px: number) => void
  /** Reset all widths: clear persistence and revert to defaults. */
  resetWidths: () => void
}

/**
 * Owns per-column widths for a Table. When `tableId` is provided, widths
 * are persisted to localStorage under `ecu:table:<tableId>:column-widths`
 * (debounced). Stale entries (columns no longer in `columns`) are pruned
 * on the next write.
 */
export function useColumnWidths(tableId: string | undefined, columns: WidthColumnDef[]): UseColumnWidthsResult {
  // Read persisted widths once for the initial state. Passing a function
  // to useState so we don't re-read storage on every render.
  const [widths, setWidths] = useState<Record<string, number | undefined>>(
    () => buildInitialWidths(columns, tableId ? loadFromStorage(tableId) : null)
  )

  // Track the column ids seen so far. When the column set changes we
  // re-seed missing entries so new columns pick up their defaults.
  const knownIdsRef = useRef<Set<string>>(new Set(columns.map((c) => c.id)))

  // Re-sync when the `columns` array changes. Fixed widths (`col.width`)
  // are authoritative — the hook always reflects the prop value, which
  // also lets the caller drive dynamic widths (e.g. autoWidth columns
  // that are measured after render). Resizable columns preserve any
  // user-set value from the current state.
  useEffect(() => {
    const nextIds = new Set(columns.map((c) => c.id))
    const prevIds = knownIdsRef.current

    setWidths((prev) => {
      const next: Record<string, number | undefined> = {}
      let changed = false

      for (const col of columns) {
        const existing = prev[col.id]
        const wasKnown = prevIds.has(col.id)
        if (col.width !== undefined) {
          // Fixed (or externally-driven) width — always use the prop.
          next[col.id] = col.width
          if (existing !== col.width) changed = true
        } else if (!wasKnown) {
          // New resizable column — seed from default.
          changed = true
          next[col.id] = col.defaultWidth
        } else {
          // Existing resizable column — preserve state (user-set or default).
          next[col.id] = existing
        }
      }

      // Detect removals.
      for (const id of Object.keys(prev)) {
        if (!nextIds.has(id)) { changed = true; break }
      }

      return changed ? next : prev
    })

    knownIdsRef.current = nextIds
  }, [columns])

  // Debounced persist
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [])

  const schedulePersist = useCallback((next: Record<string, number | undefined>) => {
    if (!tableId) return
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      const validIds = new Set(columns.map((c) => c.id))
      const payload: Record<string, number> = {}
      for (const [id, value] of Object.entries(next)) {
        // Only persist resizable columns with a concrete number. Fixed
        // columns live in code; unsaved (undefined) columns share space.
        if (!validIds.has(id) || value === undefined) continue
        const col = columns.find((c) => c.id === id)
        if (!col || col.width !== undefined) continue
        payload[id] = value
      }
      writeToStorage(tableId, payload)
    }, 100)
  }, [tableId, columns])

  const columnsById = useMemo(() => {
    const map = new Map<string, WidthColumnDef>()
    for (const c of columns) map.set(c.id, c)
    return map
  }, [columns])

  const setWidth = useCallback((id: string, px: number) => {
    const col = columnsById.get(id)
    if (!col) return
    if (col.width !== undefined) return // fixed, not resizable
    const next = clamp(px, col.minWidth ?? DEFAULT_MIN_WIDTH, col.maxWidth)
    setWidths((prev) => {
      if (prev[id] === next) return prev
      const merged = { ...prev, [id]: next }
      schedulePersist(merged)
      return merged
    })
  }, [columnsById, schedulePersist])

  const resetWidths = useCallback(() => {
    if (tableId) removeFromStorage(tableId)
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    setWidths(buildInitialWidths(columns, null))
  }, [tableId, columns])

  return { widths, setWidth, resetWidths }
}
