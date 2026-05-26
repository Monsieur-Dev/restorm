import React, { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { isMacintosh } from '../../hooks/usePlatform'
import { useFilterableDropdown } from '../../hooks/useFilterableDropdown'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import { DropdownFilterRow } from '../DropdownFilterRow'
import { SelectBoxListProps, ISelectOptionItem } from './types'
import { ScrollableElement } from '../ScrollableElement'
import './selectBox.css'
import './selectBoxCustom.css'

// Template data interface (kept for compatibility)
// interface SelectListTemplateData {
//   root: HTMLElement
//   text: HTMLElement
//   detail: HTMLElement
//   decoratorRight: HTMLElement
// }

const SelectBoxList: React.FC<SelectBoxListProps> = ({
  options,
  selected,
  onDidSelect,
  selectBoxOptions,
  styles,
  className,
  id,
  'data-testid': dataTestId,
  filterThreshold,
  filterPlaceholder,
  filterTestId
}) => {
  const testId = dataTestId ?? id

  // Map an option to its searchable display text. The custom `label`
  // ReactNode is collapsed to '' (rare) — `text` is always the
  // canonical fallback for both native serialisation and search.
  const getOptionLabel = useMemo(() => (option: ISelectOptionItem): string => {
    if (typeof option.label === 'string') return option.label
    if (typeof option.label === 'number' || typeof option.label === 'boolean') return String(option.label)
    return option.text
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
  } = useFilterableDropdown<ISelectOptionItem>(filterArgs)
  const [isVisible, setIsVisible] = useState(false)
  // Track internal selection override with the 'selected' value it was set for
  const [internalState, setInternalState] = useState<{
    forSelected: number
    selection: number | null
    focus: number | null
  }>({ forSelected: selected, selection: null, focus: null })
  
  // Derive current values: use internal state only if it was set for the current 'selected' prop
  const internalIsValid = internalState.forSelected === selected
  const currentSelection = internalIsValid && internalState.selection !== null 
    ? internalState.selection 
    : selected
  const focusedIndex = internalIsValid && internalState.focus !== null 
    ? internalState.focus 
    : selected

  // Helper to update internal selection
  const setInternalSelection = useCallback((value: number | null) => {
    setInternalState(prev => ({ ...prev, forSelected: selected, selection: value }))
  }, [selected])

  // Helper to update internal focus  
  const setInternalFocus = useCallback((value: number | null) => {
    setInternalState(prev => ({ ...prev, forSelected: selected, focus: value }))
  }, [selected])
  
  const selectRef = useRef<HTMLSelectElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const portalContainerRef = useRef<Element | null>(null)
  useOverlayPresence(dropdownRef, isVisible)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })

  // Handle selection change
  const handleSelectChange = useCallback((index: number): void => {
    if (index >= 0 && index < options.length) {
      setInternalSelection(index)
      onDidSelect({
        selected: options[index]?.text ?? '',
        index
      })
    }
  }, [options, onDidSelect, setInternalSelection])

  // Show dropdown
  const showDropdown = useCallback((): void => {
    if (isVisible) return
    setIsVisible(true)
    setInternalFocus(currentSelection)
  }, [isVisible, currentSelection, setInternalFocus])

  // Reset the filter every time the popup closes — the user opens
  // a fresh dropdown, not a session-leftover view.
  useEffect(() => {
    if (!isVisible) clearFilter()
  }, [isVisible, clearFilter])

  // Map an original-array index to its position inside `filteredItems`.
  // Returns -1 when the option is currently filtered out.
  const filteredIndexFor = useCallback((origIndex: number): number => {
    const target = options[origIndex]
    if (!target) return -1
    return filteredItems.indexOf(target)
  }, [filteredItems, options])

  // Map a filtered-array index back to the original-options index.
  const originalIndexFor = useCallback((filteredIdx: number): number => {
    const item = filteredItems[filteredIdx]
    if (!item) return -1
    return options.indexOf(item)
  }, [filteredItems, options])

  // When the visible slice shrinks past the focused row, snap focus
  // back to the first visible row so arrow keys / Enter don't act
  // on a hidden option.
  useEffect(() => {
    if (!isVisible) return
    const visibleIdx = filteredIndexFor(focusedIndex)
    if (visibleIdx >= 0) return
    const firstFocusable = filteredItems.findIndex((opt) => !opt.isDisabled)
    if (firstFocusable >= 0) {
      const orig = originalIndexFor(firstFocusable)
      if (orig >= 0) setInternalFocus(orig)
    }
  }, [filteredItems, isVisible, focusedIndex, filteredIndexFor, originalIndexFor, setInternalFocus])

  // Hide dropdown
  const hideDropdown = useCallback((focusSelect: boolean): void => {
    setIsVisible(false)
    if (focusSelect && selectRef.current) {
      selectRef.current.focus()
    }
  }, [])

  // Handle click on select element
  const handleSelectClick = useCallback((event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    
    if (isVisible) {
      hideDropdown(true)
    } else {
      showDropdown()
    }
  }, [isVisible, showDropdown, hideDropdown])

  // Handle mouse down on select element
  const handleSelectMouseDown = useCallback((event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    let showDropDown = false

    if (isMacintosh) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ' || event.key === 'Enter') {
        showDropDown = true
      }
    } else {
      if ((event.key === 'ArrowDown' && event.altKey) || 
          (event.key === 'ArrowUp' && event.altKey) || 
          event.key === ' ' || 
          event.key === 'Enter') {
        showDropDown = true
      }
    }

    if (showDropDown) {
      showDropdown()
      event.preventDefault()
      event.stopPropagation()
    }
  }, [showDropdown])

  // Handle option click
  const handleOptionClick = useCallback((index: number): void => {
    const option = options[index]
    if (option && !option.isDisabled) {
      handleSelectChange(index)
      hideDropdown(true)
    }
  }, [options, handleSelectChange, hideDropdown])

  // Handle option hover
  const handleOptionHover = useCallback((index: number): void => {
    setInternalFocus(index)
  }, [setInternalFocus])

  // Handle dropdown keyboard navigation
  const handleDropdownKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (!isVisible) return
    const visibleIdx = filteredIndexFor(focusedIndex)

    switch (event.key) {
      case 'Enter':
      case 'Tab': {
        event.preventDefault()
        if (focusedIndex >= 0 && options[focusedIndex] && !options[focusedIndex].isDisabled) {
          handleSelectChange(focusedIndex)
          hideDropdown(true)
        }
        break
      }

      case 'Escape':
        event.preventDefault()
        hideDropdown(true)
        break

      case 'ArrowDown': {
        event.preventDefault()
        if (filteredItems.length === 0) break
        let nextVisible = visibleIdx < 0 ? 0 : visibleIdx + 1
        while (nextVisible < filteredItems.length && filteredItems[nextVisible]?.isDisabled) {
          nextVisible++
        }
        if (nextVisible < filteredItems.length) {
          const orig = originalIndexFor(nextVisible)
          if (orig >= 0) setInternalFocus(orig)
        }
        break
      }

      case 'ArrowUp': {
        event.preventDefault()
        if (filteredItems.length === 0) break
        let prevVisible = visibleIdx <= 0 ? -1 : visibleIdx - 1
        while (prevVisible >= 0 && filteredItems[prevVisible]?.isDisabled) {
          prevVisible--
        }
        if (prevVisible >= 0) {
          const orig = originalIndexFor(prevVisible)
          if (orig >= 0) setInternalFocus(orig)
        }
        break
      }

      case 'Home': {
        event.preventDefault()
        if (filteredItems.length === 0) break
        const orig = originalIndexFor(0)
        if (orig >= 0) setInternalFocus(orig)
        break
      }

      case 'End': {
        event.preventDefault()
        if (filteredItems.length === 0) break
        const orig = originalIndexFor(filteredItems.length - 1)
        if (orig >= 0) setInternalFocus(orig)
        break
      }
    }
  }, [isVisible, focusedIndex, options, filteredItems, filteredIndexFor, originalIndexFor, handleSelectChange, hideDropdown, setInternalFocus])

  // Filter input keyboard: Esc clear-then-close (delegated to hook),
  // ArrowDown/ArrowUp/Home/End/Enter mirror the listbox handler so
  // the user can navigate without leaving the input.
  const handleFilterInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    handleFilterKeyDown(event)
    if (event.defaultPrevented) return
    handleDropdownKeyDown(event as unknown as React.KeyboardEvent)
  }, [handleFilterKeyDown, handleDropdownKeyDown])

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (dropdownRef.current && !dropdownRef.current.contains(target) &&
          triggerRef.current && !triggerRef.current.contains(target) &&
          selectRef.current && !selectRef.current.contains(target)) {
        hideDropdown(false)
      }
    }

    if (isVisible) {
      // Capture phase: a host that consumes the event before it bubbles to
      // `document` (e.g. a React Flow canvas calling `stopPropagation` on its
      // pane mousedown during a pan) would otherwise swallow it and leave the
      // dropdown stuck open. Capturing at the document fires first, regardless.
      document.addEventListener('mousedown', handleClickOutside, true)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
    }
  }, [isVisible, hideDropdown])

  // Apply styles when component mounts or styles change
  useEffect(() => {
    if (selectRef.current) {
      const element = selectRef.current
      element.style.backgroundColor = styles.selectBackground ?? ''
      element.style.color = styles.selectForeground ?? ''
      element.style.borderColor = styles.selectBorder ?? ''
    }
  }, [styles])

  // Calculate dropdown position from the trigger when it becomes visible
  useLayoutEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width
      })
    }
  }, [isVisible])

  // Build CSS classes
  const selectClasses = [
    'select-box',
    'select-box-dropdown-padding',
    'setting-control-focus-target',
    isVisible ? 'synthetic-focus' : '',
    className
  ].filter(Boolean).join(' ')

  const dropdownClasses = [
    'select-box-dropdown-container',
    isVisible ? 'visible' : ''
  ].filter(Boolean).join(' ')

  // Get selected option
  const selectedOption = options[currentSelection] ?? options[0]

  // Compute a dropdown max-height that fits content up to a reasonable max.
  // Using maxHeight (without forcing height) lets the list shrink to content
  // when there are only a few items, while still scrolling if there are many.
  const visibleItemCount = Math.min(options.length, 8)
  const optionRowHeight = 28 // Approximate row height in px
  const dropdownHeight = visibleItemCount * optionRowHeight

  return (
    <div
      className="select-container custom"
      data-testid={testId}
      data-is-open={isVisible ? 'true' : 'false'}
      data-selected-index={String(currentSelection)}
      data-focused-index={String(focusedIndex)}
    >
      {/* Hidden select element for accessibility */}
      <select
        ref={selectRef}
        id={id}
        className={`${selectClasses} hidden-select`}
        onClick={handleSelectClick}
        onMouseDown={handleSelectMouseDown}
        onKeyDown={handleKeyDown}
        aria-label={selectBoxOptions.ariaLabel}
        aria-description={selectBoxOptions.ariaDescription}
        aria-expanded={isVisible}
        tabIndex={0}
        data-testid={`${testId}-select`}
      >
        {options.map((option, index) => (
          <option
            key={index}
            value={option.text}
            disabled={option.isDisabled}
          >
            {option.text}
          </option>
        ))}
      </select>

      {/* Custom dropdown trigger */}
      <div
        ref={triggerRef}
        className={`${selectClasses} custom-trigger`}
        onClick={handleSelectClick}
        onMouseDown={handleSelectMouseDown}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="combobox"
        aria-expanded={isVisible}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        data-testid={`${testId}-trigger`}
      >
        <span className="select-text">
          {selectedOption ? (selectedOption.label ?? selectedOption.text) : 'Select...'}
        </span>
        <span className="codicon codicon-chevron-down select-arrow" />
      </div>

      {/* Custom dropdown — portaled to body to escape overflow:hidden ancestors */}
      {isVisible && createPortal(
        <div
          ref={dropdownRef}
          className={`${dropdownClasses} positioned`}
          data-testid={`${testId}-dropdown`}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            minWidth: dropdownPos.width
          }}
        >
            {shouldRenderFilter && (
              <DropdownFilterRow
                value={filterValue}
                onChange={setFilterValue}
                onKeyDown={handleFilterInputKeyDown}
                {...(filterPlaceholder !== undefined && { placeholder: filterPlaceholder })}
                {...(filterTestId !== undefined ? { 'data-testid': filterTestId } : { 'data-testid': `${testId}-filter` })}
              />
            )}
            <ScrollableElement
              options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, handleMouseWheel: true, fitContent: true }}
              className="select-scrollable-wrapper"
              style={{ maxHeight: `${dropdownHeight}px`, width: '100%' }}
              data-testid={`${testId}-scrollable`}
            >
              <div
                id={`${id}-listbox`}
                role="listbox"
                aria-activedescendant={focusedIndex >= 0 ? `${id}-option-${focusedIndex}` : undefined}
                className="select-list-container"
                onKeyDown={handleDropdownKeyDown}
                tabIndex={0}
                data-testid={`${testId}-listbox`}
              >
              {filteredItems.length === 0 ? (
                <div
                  className="select-option"
                  data-testid={`${testId}-no-matches`}
                  style={{ opacity: 0.7, fontStyle: 'italic', cursor: 'default' }}
                >
                  No matches
                </div>
              ) : filteredItems.map((option) => {
                const index = options.indexOf(option)
                const isSelected = index === currentSelection
                const isFocused = index === focusedIndex
                return (
                  <div
                    key={index}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { handleOptionClick(index); }}
                    className={`select-option ${isSelected ? 'focused' : ''} ${option.isDisabled ? 'disabled' : ''}`}
                    onMouseEnter={() => { handleOptionHover(index); }}
                    data-testid={`${testId}-option-${index}`}
                    data-is-selected={isSelected ? 'true' : 'false'}
                    data-is-disabled={option.isDisabled ? 'true' : 'false'}
                    data-is-focused={isFocused ? 'true' : 'false'}
                  >
                    <div className="select-option-content">
                      <div className="select-option-header">
                        <span className="option-text" data-testid={`${testId}-option-${index}-label`}>
                          {option.label ?? option.text}
                        </span>
                        {option.detail && (
                          <span className="option-detail" data-testid={`${testId}-option-${index}-detail`}>
                            {option.detail}
                          </span>
                        )}
                      </div>
                    </div>
                    {option.decoratorRight && (
                      <span className="select-option-decorator" data-testid={`${testId}-option-${index}-decorator`}>
                        {option.decoratorRight}
                      </span>
                    )}
                  </div>
                )
              })}
              </div>
            </ScrollableElement>

          {/* Details pane for descriptions */}
          {options.some(option => option.description !== undefined) && (
            <div className="select-box-details-pane border-top" data-testid={`${testId}-details`}>
              {selectedOption?.description}
            </div>
          )}
        </div>,
        (portalContainerRef.current ??= triggerRef.current?.closest('.workbench') ?? document.body)
      )}
    </div>
  )
}

export default SelectBoxList
