import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useFilterableDropdown } from '../hooks/useFilterableDropdown'
import { useOverlayPresence } from '../hooks/useOverlayPresence'
import { DropdownFilterRow } from './DropdownFilterRow'
import { ScrollableElement } from './ScrollableElement'

interface CustomDropdownOption {
  value: string
  label: React.ReactNode
  /**
   * Optional plain-text override the substring filter matches against.
   * When the `label` is JSX (e.g. icon + text spans) callers should
   * pass the user-readable text here so the filter sees something
   * meaningful instead of `[object Object]` from `String(reactNode)`.
   */
  searchText?: string
}

interface CustomDropdownProps {
  id?: string
  value: string
  options: CustomDropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  /**
   * Item count at or above which a sticky filter row appears at the
   * top of the popup. Default: `15` (`DEFAULT_FILTER_THRESHOLD`).
   * Pass a large value to opt out per-instance.
   */
  filterThreshold?: number
  /** Localised placeholder for the filter input. */
  filterPlaceholder?: string
  /** Optional test id forwarded to the filter row. */
  filterTestId?: string
}

const CustomDropdown: React.FC<CustomDropdownProps> = ({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select...',
  filterThreshold,
  filterPlaceholder,
  filterTestId
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const portalContainerRef = useRef<Element | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [listPos, setListPos] = useState({ top: 0, left: 0, width: 0 })

  // While the popup is open, register it with the overlay-presence
  // service so a main-process compositor view (the Mini browser's
  // `WebContentsView`) collapses out from under it — a fixed-position
  // HTML dropdown can't otherwise out-stack a native view. Mirrors the
  // SelectBox / Tooltip / Modal registrations.
  useOverlayPresence(popupRef, isOpen)

  const selectedOption = options.find(opt => opt.value === value)

  const getOptionLabel = useMemo(() => (option: CustomDropdownOption): string => {
    if (option.searchText !== undefined) return option.searchText
    if (typeof option.label === 'string') return option.label
    if (typeof option.label === 'number' || typeof option.label === 'boolean') return String(option.label)
    // ReactNode label without an explicit `searchText` falls through
    // to an empty string — host components with JSX labels should
    // pass `searchText` for the filter to find them.
    return ''
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
  } = useFilterableDropdown<CustomDropdownOption>(filterArgs)

  // Reset filter state when the popup closes — don't surprise the
  // user with a leftover filter the next time they open the dropdown.
  useEffect(() => {
    if (!isOpen) clearFilter()
  }, [isOpen, clearFilter])

  // Reset the focused index when the visible slice changes so arrow
  // keys don't navigate to a row that was just filtered out.
  useEffect(() => {
    if (!isOpen) return
    const selectedIdxInFiltered = filteredItems.findIndex((opt) => opt.value === value)
    setFocusedIndex(selectedIdxInFiltered >= 0 ? selectedIdxInFiltered : 0)
  }, [filteredItems, isOpen, value])

  // Calculate list position when opened
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setListPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }, [isOpen])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      // If click is inside the trigger container, ignore (trigger handles its own toggle)
      if (dropdownRef.current?.contains(target)) return
      // If click is inside the portaled popup (filter row + list), ignore.
      if (popupRef.current?.contains(target)) return
      setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (disabled) return

    switch (e.key) {
      case 'Enter':
      case ' ':
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(filteredItems.findIndex(opt => opt.value === value))
        } else if (focusedIndex >= 0 && filteredItems[focusedIndex]) {
          onChange(filteredItems[focusedIndex].value)
          setIsOpen(false)
        }
        e.preventDefault()
        break

      case 'Escape':
        setIsOpen(false)
        e.preventDefault()
        break

      case 'ArrowDown':
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(filteredItems.findIndex(opt => opt.value === value))
        } else {
          setFocusedIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
        }
        e.preventDefault()
        break

      case 'ArrowUp':
        if (isOpen) {
          setFocusedIndex(prev => Math.max(prev - 1, 0))
        }
        e.preventDefault()
        break

      case 'Home':
        if (isOpen) {
          setFocusedIndex(0)
        }
        e.preventDefault()
        break

      case 'End':
        if (isOpen) {
          setFocusedIndex(filteredItems.length - 1)
        }
        e.preventDefault()
        break
    }
  }

  // Filter input keyboard: Esc clears non-empty filter; arrows navigate
  // the option list below; Enter activates the focused row.
  const handleFilterInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    handleFilterKeyDown(e)
    if (e.defaultPrevented) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => Math.max(prev - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setFocusedIndex(0)
        break
      case 'End':
        e.preventDefault()
        setFocusedIndex(filteredItems.length - 1)
        break
      case 'Enter':
        if (focusedIndex >= 0 && filteredItems[focusedIndex]) {
          e.preventDefault()
          onChange(filteredItems[focusedIndex].value)
          setIsOpen(false)
        }
        break
      case 'Escape':
        // After the filter hook has cleared a non-empty filter
        // (defaultPrevented above), we wouldn't reach here. With an
        // already-empty filter, close the popup.
        setIsOpen(false)
        e.preventDefault()
        break
      default:
        break
    }
  }

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      const focusedElement = listRef.current.children[focusedIndex] as HTMLElement | undefined
      focusedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex, isOpen])

  const handleOptionClick = (optionValue: string): void => {
    onChange(optionValue)
    setIsOpen(false)
  }

  return (
    <div
      ref={dropdownRef}
      id={id}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '400px'
      }}
    >
      {/* Dropdown button */}
      <div
        ref={triggerRef}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen)
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          backgroundColor: 'var(--dropdown-background)',
          color: 'var(--tab-active-text-color)',
          border: '1px solid var(--dropdown-border)',
          borderRadius: '2px',
          fontSize: '13px',
          fontFamily: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          outline: 'none'
        }}
        onFocus={(e) => {
          e.currentTarget.style.outline = '1px solid var(--focusBorder)'
          e.currentTarget.style.outlineOffset = '-1px'
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = 'none'
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {/* Chevron icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          style={{ marginLeft: '8px', flexShrink: 0, opacity: 0.8 }}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"
          />
        </svg>
      </div>

      {/* Dropdown popup — portaled to body to escape overflow:hidden ancestors */}
      {isOpen && createPortal(
        <div
          ref={popupRef}
          style={{
            position: 'fixed',
            top: listPos.top,
            left: listPos.left,
            width: listPos.width,
            maxHeight: '300px',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--editor-background)',
            border: '1px solid var(--dropdown-border)',
            borderRadius: '2px',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
            zIndex: 10001
          }}
        >
          {shouldRenderFilter && (
            <DropdownFilterRow
              value={filterValue}
              onChange={setFilterValue}
              onKeyDown={handleFilterInputKeyDown}
              {...(filterPlaceholder !== undefined && { placeholder: filterPlaceholder })}
              {...(filterTestId !== undefined && { 'data-testid': filterTestId })}
            />
          )}
          <ScrollableElement
            options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, handleMouseWheel: true, fitContent: true }}
            style={{ flex: '1 1 auto', width: '100%', minHeight: 0, overflow: 'hidden' }}
          >
          <div
            ref={listRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-activedescendant={focusedIndex >= 0 ? `${id}-option-${focusedIndex}` : undefined}
          >
            {filteredItems.length === 0 ? (
              <div
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  color: 'var(--descriptionForeground, var(--tab-active-text-color))',
                  opacity: 0.7,
                  fontStyle: 'italic'
                }}
              >
                No matches
              </div>
            ) : (
              filteredItems.map((option, index) => (
                <div
                  key={option.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    handleOptionClick(option.value)
                  }}
                  onMouseEnter={() => {
                    setFocusedIndex(index)
                  }}
                  style={{
                    padding: '3px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    backgroundColor:
                      focusedIndex === index
                        ? 'var(--list-hoverBackground)'
                        : option.value === value
                        ? 'var(--list-activeSelectionBackground)'
                        : 'transparent',
                    color:
                      option.value === value
                        ? 'var(--list-activeSelectionForeground)'
                        : 'var(--tab-active-text-color)',
                    fontWeight: option.value === value ? '500' : '400',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {option.label}
                </div>
              ))
            )}
          </div>
          </ScrollableElement>
        </div>,
        (portalContainerRef.current ??= triggerRef.current?.closest('.workbench') ?? document.body)
      )}
    </div>
  )
}

export default CustomDropdown
