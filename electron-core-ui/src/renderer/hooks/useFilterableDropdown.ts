import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'

/**
 * Shared filter-row + select-all behaviour for dropdowns.
 *
 * Dropdowns whose item count climbs past a few dozen turn into pure
 * scroll affordances. This hook layers a sticky filter input on top
 * of the popup body — without changing the host's selection model —
 * and (optionally) exposes Select-all / Deselect-all callbacks that
 * act on the *currently visible* items so a multi-select consumer
 * can do "filter + select-all matching" in one stroke.
 *
 * Each affected component (CustomDropdown, SelectBox, MultiSelectCombo,
 * ListViewDropdown, IconSelect) calls this with a small extractor that
 * pulls the user-visible label out of its own item shape. The hook
 * is shape-agnostic: the only invariant it needs is "given an item,
 * return a string to substring-match against".
 *
 * Behaviour summary:
 * - `shouldRenderFilter` is true when `items.length` ≥ `threshold`
 *   (default `15`). Below that the host renders nothing extra and
 *   keeps its previous behaviour byte-for-byte.
 * - Filtering is case-insensitive substring matching on the trimmed
 *   query. An empty query returns every item.
 * - The hook does not own any focus / keyboard / DOM state — it
 *   exposes pure data + callbacks the host wires up. The host
 *   decides where the filter input renders, which arrow-key handler
 *   navigates over the filtered slice, etc.
 */

export interface UseFilterableDropdownOptions<T> {
  /** Full item list before filtering. */
  readonly items: readonly T[]
  /** Threshold (inclusive) at or above which the filter row appears. Default: 15. */
  readonly threshold?: number
  /**
   * Map an item to its user-visible display text. Anything coercible
   * to a string works. The hook normalises the result with
   * `String(...)` defensively so a `ReactNode` label that the host
   * forgot to flatten doesn't crash the substring match.
   */
  readonly getLabel: (item: T) => unknown
}

export interface UseFilterableDropdownResult<T> {
  /** Whether the filter row should be rendered. */
  readonly shouldRenderFilter: boolean
  /** Current filter value (verbatim — no trim, no case fold). */
  readonly filterValue: string
  /** Update the filter. */
  readonly setFilterValue: (next: string) => void
  /** Clear the filter to the empty string. */
  readonly clearFilter: () => void
  /** Items currently passing the filter, preserving the input order. */
  readonly filteredItems: readonly T[]
  /**
   * `Esc` handler the host can attach to the filter input. First press
   * with a non-empty filter clears it and stops propagation (so the
   * popup stays open); a press on an already-empty filter falls
   * through (host's existing close-on-Esc keeps working).
   */
  readonly handleFilterKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export const DEFAULT_FILTER_THRESHOLD = 15

/**
 * Pure substring filter, exposed separately from the hook so tests
 * can exercise the matching logic without spinning up React. Empty /
 * whitespace-only queries return the input untouched (same identity)
 * so callers can use `===` to skip work.
 */
export function applyDropdownFilter<T>(
  items: readonly T[],
  filterValue: string,
  getLabel: (item: T) => unknown
): readonly T[] {
  const query = filterValue.trim().toLowerCase()
  if (query === '') return items
  return items.filter((item) => {
    const raw = getLabel(item)
    // `getLabel` is typed `unknown` — callers may legitimately pass
    // strings, primitives, or nullish. For non-primitive values we
    // stringify via JSON to avoid silently matching every query
    // through `Object.prototype.toString`'s `[object Object]`.
    let text: string
    if (raw == null) {
      text = ''
    } else if (typeof raw === 'string') {
      text = raw
    } else if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
      text = String(raw)
    } else {
      // Last-resort JSON serialisation. May still throw on circular
      // refs — fall back to '' so the filter doesn't poison-pill the
      // entire popup.
      try {
        const serialised = JSON.stringify(raw)
        text = typeof serialised === 'string' ? serialised : ''
      } catch { text = '' }
    }
    return text.toLowerCase().includes(query)
  })
}

export function useFilterableDropdown<T>(
  options: UseFilterableDropdownOptions<T>
): UseFilterableDropdownResult<T> {
  const { items, getLabel } = options
  const threshold = options.threshold ?? DEFAULT_FILTER_THRESHOLD
  const [filterValue, setFilterValue] = useState('')

  const shouldRenderFilter = items.length >= threshold

  const filteredItems = useMemo<readonly T[]>(() => {
    if (!shouldRenderFilter) return items
    return applyDropdownFilter(items, filterValue, getLabel)
  }, [items, getLabel, filterValue, shouldRenderFilter])

  const clearFilter = useCallback(() => { setFilterValue('') }, [])

  const handleFilterKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    if (filterValue !== '') {
      // First Esc with a non-empty filter clears it and keeps the
      // popup open; second Esc (with an empty filter) bubbles to the
      // host's existing close-on-Esc handler.
      event.preventDefault()
      event.stopPropagation()
      setFilterValue('')
    }
  }, [filterValue])

  return {
    shouldRenderFilter,
    filterValue,
    setFilterValue,
    clearFilter,
    filteredItems,
    handleFilterKeyDown
  }
}
