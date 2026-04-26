import React, { useEffect, useRef, type KeyboardEvent } from 'react'
import { InputBox } from '../InputBox'
import { Button } from '../Button'
import './dropdownFilterRow.css'

export interface DropdownFilterRowProps {
  /** Current filter value (controlled). */
  value: string
  /** Update the filter. */
  onChange: (next: string) => void
  /**
   * Keyboard handler. The `useFilterableDropdown` hook returns one
   * (`handleFilterKeyDown`) that handles `Esc` clear-then-fall-through.
   */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  /** Placeholder shown in the input. Default: `Filter…`. */
  placeholder?: string
  /**
   * If provided, renders a `Select all` action button. Acts on the
   * currently visible (filtered) items — the host wires the actual
   * effect on its selection model.
   */
  onSelectAllVisible?: () => void
  /** If provided, renders a `Deselect all` action button. */
  onDeselectAllVisible?: () => void
  /** Localised label for `Select all`. Default: `Select all`. */
  selectAllLabel?: string
  /** Localised label for `Deselect all`. Default: `Deselect all`. */
  deselectAllLabel?: string
  /**
   * Auto-focus the filter input on mount. Default `true` — dropdowns
   * spawn the row on open, and the user expects to start typing
   * immediately.
   */
  autoFocus?: boolean
  /** Optional test id forwarded to the row container. */
  'data-testid'?: string
}

/**
 * Sticky filter + bulk-select row for dropdown popups. Sits at the
 * top of a dropdown body and stays in place while the items below
 * scroll. The `Select all` / `Deselect all` buttons are opt-in and
 * only render when the host wires up the corresponding callback —
 * single-select dropdowns just omit them.
 *
 * The row owns no filter state — it's a controlled view over the
 * `useFilterableDropdown` hook's `filterValue` / `setFilterValue` so
 * keyboard navigation in the host stays in lock-step with the
 * filtered slice.
 */
export const DropdownFilterRow: React.FC<DropdownFilterRowProps> = ({
  value,
  onChange,
  onKeyDown,
  placeholder = 'Filter\u2026',
  onSelectAllVisible,
  onDeselectAllVisible,
  selectAllLabel = 'Select all',
  deselectAllLabel = 'Deselect all',
  autoFocus = true,
  'data-testid': dataTestId
}) => {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    // The popup itself is portaled to the workbench / body, so the
    // input only mounts after the host has positioned the popup.
    // Defer the focus by a microtask so the focus call lands AFTER
    // any focus the host might be moving onto the popup container
    // (e.g. an `onOpenAutoFocus` Radix wrapper a future refactor
    // could introduce). Cheap and idempotent.
    const id = setTimeout(() => { inputRef.current?.focus() }, 0)
    return () => { clearTimeout(id) }
  }, [autoFocus])

  return (
    <div
      className="dropdown-filter-row"
      data-testid={dataTestId}
      // Keep mousedown inside the row from bubbling to the host's
      // click-outside handler (some popups close on `mousedown`
      // outside the option list — the filter input lives at the
      // popup's top edge, so we mark its own clicks as "inside").
      onMouseDown={(e) => { e.stopPropagation() }}
    >
      <InputBox
        inputRef={inputRef}
        value={value}
        onChange={onChange}
        {...(onKeyDown !== undefined && { onKeyDown })}
        changeDebounceMs={0}
        options={{ placeholder, ariaLabel: placeholder, type: 'text' }}
        className="dropdown-filter-row__input"
        {...(dataTestId !== undefined && { 'data-testid': `${dataTestId}-input` })}
      />
      {(onSelectAllVisible !== undefined || onDeselectAllVisible !== undefined) && (
        <div className="dropdown-filter-row__actions">
          {onSelectAllVisible !== undefined && (
            <Button
              small
              secondary
              icon="check-all"
              options={{ ariaLabel: selectAllLabel, title: selectAllLabel }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onSelectAllVisible()
              }}
              {...(dataTestId !== undefined && { 'data-testid': `${dataTestId}-select-all` })}
            />
          )}
          {onDeselectAllVisible !== undefined && (
            <Button
              small
              secondary
              icon="clear-all"
              options={{ ariaLabel: deselectAllLabel, title: deselectAllLabel }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDeselectAllVisible()
              }}
              {...(dataTestId !== undefined && { 'data-testid': `${dataTestId}-deselect-all` })}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default DropdownFilterRow
