import React, { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ScrollableElement } from '../ScrollableElement'
import { useFilterableDropdown } from '../../hooks/useFilterableDropdown'
import { DropdownFilterRow } from '../DropdownFilterRow'
import './multiSelectCombo.css'

/**
 * An option in the multi-select dropdown.
 */
export interface MultiSelectComboOption {
  /** Unique value used for selection tracking and serialization. */
  value: string
  /** Display label shown in the dropdown and collapsed summary. Falls back to `value`. */
  label?: string
}

/**
 * Props for {@link MultiSelectCombo}.
 */
export interface MultiSelectComboProps {
  /** Available options to choose from. */
  options: MultiSelectComboOption[]
  /** Currently selected option values. */
  selected: string[]
  /** Callback fired whenever the selection changes (toggle on/off). */
  onChange: (selected: string[]) => void
  /** Placeholder text shown when nothing is selected. */
  placeholder?: string
  /** Optional test id. Each option gets `${dataTestId}-option-${value}`. */
  'data-testid'?: string
  /**
   * Item count at or above which a sticky filter row appears at the
   * top of the popup. Default: `15` (`DEFAULT_FILTER_THRESHOLD`).
   * Pass a large value to opt out per-instance.
   */
  filterThreshold?: number
  /** Localised placeholder for the filter input. */
  filterPlaceholder?: string
  /** Localised label for the Select-all action. */
  selectAllLabel?: string
  /** Localised label for the Deselect-all action. */
  deselectAllLabel?: string
  /** Optional test id forwarded to the filter row. */
  filterTestId?: string
}

/**
 * Multi-select combo box with checkbox toggles.
 *
 * Renders as a compact trigger showing the comma-separated selection
 * (with ellipsis overflow). Clicking opens a portal-based dropdown
 * with checkboxes for each option. Supports keyboard navigation
 * (Arrow keys, Enter/Space to toggle, Escape to close).
 *
 * The dropdown uses {@link ScrollableElement} for consistent scrollbar
 * styling and portals into the nearest `.workbench` ancestor to
 * inherit the application font and escape overflow clipping.
 *
 * @example
 * ```tsx
 * const [selected, setSelected] = useState<string[]>([])
 * const options = [
 *   { value: 'available', label: 'Available' },
 *   { value: 'pending', label: 'Pending' },
 *   { value: 'sold', label: 'Sold' }
 * ]
 * <MultiSelectCombo
 *   options={options}
 *   selected={selected}
 *   onChange={setSelected}
 *   placeholder="Select statuses..."
 * />
 * ```
 */
const MultiSelectCombo: React.FC<MultiSelectComboProps> = ({
  options,
  selected,
  onChange,
  placeholder = 'Select...',
  'data-testid': dataTestId,
  filterThreshold,
  filterPlaceholder,
  selectAllLabel,
  deselectAllLabel,
  filterTestId
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const portalContainerRef = useRef<Element | null>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const getOptionLabel = useMemo(() => (option: MultiSelectComboOption): string => {
    return option.label ?? option.value
  }, [])

  const filterArgs = filterThreshold === undefined
    ? { items: options, getLabel: getOptionLabel }
    : { items: options, threshold: filterThreshold, getLabel: getOptionLabel }
  const {
    shouldRenderFilter,
    filterValue,
    setFilterValue,
    clearFilter,
    filteredItems,
    handleFilterKeyDown
  } = useFilterableDropdown<MultiSelectComboOption>(filterArgs)

  // Compute display label
  const displayLabel = selected.length === 0
    ? ''
    : selected
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .join(', ')

  // Position dropdown
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width })
  }, [isOpen])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => { document.removeEventListener('mousedown', handleMouseDown) }
  }, [isOpen])

  // Toggle an option
  const toggle = useCallback((value: string): void => {
    const next = selectedSet.has(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    onChange(next)
  }, [selected, selectedSet, onChange])

  const selectAllVisible = useCallback((): void => {
    if (filteredItems.length === 0) return
    const next = new Set(selected)
    for (const item of filteredItems) next.add(item.value)
    onChange([...next])
  }, [filteredItems, selected, onChange])

  const deselectAllVisible = useCallback((): void => {
    if (filteredItems.length === 0) return
    const visible = new Set(filteredItems.map((opt) => opt.value))
    onChange(selected.filter((v) => !visible.has(v)))
  }, [filteredItems, selected, onChange])

  // Reset filter every time the popup closes.
  useEffect(() => {
    if (!isOpen) clearFilter()
  }, [isOpen, clearFilter])

  // Keep the focused index inside the visible slice.
  useEffect(() => {
    if (!isOpen) return
    if (focusedIndex >= filteredItems.length) {
      setFocusedIndex(filteredItems.length === 0 ? 0 : filteredItems.length - 1)
    }
  }, [filteredItems.length, focusedIndex, isOpen])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsOpen(true)
        setFocusedIndex(0)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => Math.min(prev + 1, Math.max(filteredItems.length - 1, 0)))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => Math.max(prev - 1, 0))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (filteredItems[focusedIndex]) {
          toggle(filteredItems[focusedIndex].value)
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
    }
  }, [isOpen, focusedIndex, filteredItems, toggle])

  const handleFilterInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    handleFilterKeyDown(e)
    if (e.defaultPrevented) return
    handleKeyDown(e as unknown as React.KeyboardEvent)
  }, [handleFilterKeyDown, handleKeyDown])

  // Scroll focused option into view
  useEffect(() => {
    if (!isOpen || !dropdownRef.current) return
    const focused = dropdownRef.current.querySelector('[data-focused="true"]')
    if (focused) {
      focused.scrollIntoView({ block: 'nearest' })
    }
  }, [isOpen, focusedIndex])

  const handleTriggerClick = (): void => {
    setIsOpen((prev) => !prev)
    if (!isOpen) setFocusedIndex(0)
  }

  return (
    <>
      <div
        ref={triggerRef}
        className="ecu-multi-select-combo"
        tabIndex={0}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        {...(dataTestId && { 'data-testid': dataTestId })}
      >
        <span className={`ecu-multi-select-combo-label ${displayLabel ? '' : 'ecu-multi-select-combo-label-placeholder'}`}>
          {displayLabel || placeholder}
        </span>
        <span className="ecu-multi-select-combo-arrow codicon codicon-chevron-down" />
      </div>
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="ecu-multi-select-combo-dropdown"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 160) }}
          role="listbox"
          aria-multiselectable="true"
          {...(dataTestId && { 'data-testid': `${dataTestId}-dropdown` })}
        >
          {shouldRenderFilter && (
            <DropdownFilterRow
              value={filterValue}
              onChange={setFilterValue}
              onKeyDown={handleFilterInputKeyDown}
              {...(filterPlaceholder !== undefined && { placeholder: filterPlaceholder })}
              {...(selectAllLabel !== undefined && { selectAllLabel })}
              {...(deselectAllLabel !== undefined && { deselectAllLabel })}
              onSelectAllVisible={selectAllVisible}
              onDeselectAllVisible={deselectAllVisible}
              {...(filterTestId !== undefined ? { 'data-testid': filterTestId } : (dataTestId ? { 'data-testid': `${dataTestId}-filter` } : {}))}
            />
          )}
          <ScrollableElement
            options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, handleMouseWheel: true, fitContent: true }}
            style={{ maxHeight: 240, width: '100%' }}
          >
            {filteredItems.length === 0 ? (
              <div
                className="ecu-multi-select-combo-option"
                style={{ opacity: 0.7, fontStyle: 'italic', cursor: 'default' }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-no-matches` })}
              >
                No matches
              </div>
            ) : filteredItems.map((opt, i) => {
              const checked = selectedSet.has(opt.value)
              return (
                <div
                  key={opt.value}
                  className="ecu-multi-select-combo-option"
                  role="option"
                  aria-selected={checked}
                  data-focused={i === focusedIndex ? 'true' : 'false'}
                  onClick={(e) => { e.stopPropagation(); toggle(opt.value) }}
                  onMouseEnter={() => { setFocusedIndex(i) }}
                  {...(dataTestId && { 'data-testid': `${dataTestId}-option-${opt.value}` })}
                >
                  <span
                    className="ecu-multi-select-combo-checkbox"
                    data-checked={checked ? 'true' : 'false'}
                  >
                    {checked && <span className="codicon codicon-check" />}
                  </span>
                  <span className="ecu-multi-select-combo-option-label">
                    {opt.label ?? opt.value}
                  </span>
                </div>
              )
            })}
          </ScrollableElement>
        </div>,
        (portalContainerRef.current ??= triggerRef.current?.closest('.workbench') ?? document.body)
      )}
    </>
  )
}

const MultiSelectComboMemo = React.memo(MultiSelectCombo)
export { MultiSelectComboMemo as MultiSelectCombo }
