import React, { useState, useRef, useEffect, useCallback } from 'react'
import { isMacintosh } from '../../hooks/usePlatform'
import { SelectBoxListProps } from './types'
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
  id
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(selected)
  const [currentSelection, setCurrentSelection] = useState(selected)
  
  const selectRef = useRef<HTMLSelectElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Handle selection change
  const handleSelectChange = useCallback((index: number) => {
    if (index >= 0 && index < options.length) {
      setCurrentSelection(index)
      onDidSelect({
        selected: options[index]?.text || '',
        index
      })
    }
  }, [options, onDidSelect])

  // Show dropdown
  const showDropdown = useCallback(() => {
    if (isVisible) return
    setIsVisible(true)
    setFocusedIndex(currentSelection)
  }, [isVisible, currentSelection])

  // Hide dropdown
  const hideDropdown = useCallback((focusSelect = true) => {
    setIsVisible(false)
    if (focusSelect && selectRef.current) {
      selectRef.current.focus()
    }
  }, [])

  // Handle click on select element
  const handleSelectClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    
    if (isVisible) {
      hideDropdown(true)
    } else {
      showDropdown()
    }
  }, [isVisible, showDropdown, hideDropdown])

  // Handle mouse down on select element
  const handleSelectMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
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
  const handleOptionClick = useCallback((index: number) => {
    if (options[index] && !options[index]?.isDisabled) {
      handleSelectChange(index)
      hideDropdown(true)
    }
  }, [options, handleSelectChange, hideDropdown])

  // Handle option hover
  const handleOptionHover = useCallback((index: number) => {
    setFocusedIndex(index)
  }, [])

  // Handle dropdown keyboard navigation
  const handleDropdownKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!isVisible) return

    switch (event.key) {
      case 'Enter':
      case 'Tab':
        event.preventDefault()
        if (focusedIndex >= 0 && options[focusedIndex] && !options[focusedIndex].isDisabled) {
          handleSelectChange(focusedIndex)
          hideDropdown(true)
        }
        break

      case 'Escape':
        event.preventDefault()
        hideDropdown(true)
        break

      case 'ArrowDown':
        event.preventDefault()
        if (focusedIndex < options.length - 1) {
          let nextIndex = focusedIndex + 1
          // Skip disabled options
          while (nextIndex < options.length && options[nextIndex]?.isDisabled) {
            nextIndex++
          }
          if (nextIndex < options.length) {
            setFocusedIndex(nextIndex)
          }
        }
        break

      case 'ArrowUp':
        event.preventDefault()
        if (focusedIndex > 0) {
          let prevIndex = focusedIndex - 1
          // Skip disabled options
          while (prevIndex >= 0 && options[prevIndex]?.isDisabled) {
            prevIndex--
          }
          if (prevIndex >= 0) {
            setFocusedIndex(prevIndex)
          }
        }
        break

      case 'Home':
        event.preventDefault()
        setFocusedIndex(0)
        break

      case 'End':
        event.preventDefault()
        setFocusedIndex(options.length - 1)
        break
    }
  }, [isVisible, focusedIndex, options, handleSelectChange, hideDropdown])

  // Handle mouse wheel scrolling
  const handleWheel = useCallback(() => {
    if (!isVisible) return
    
    // Let ScrollableElement handle the wheel event naturally
    // Don't prevent default to allow normal scrolling behavior
  }, [isVisible])

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          selectRef.current && !selectRef.current.contains(event.target as Node)) {
        hideDropdown(false)
      }
    }

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isVisible, hideDropdown])

  // Update selected value when selected prop changes
  useEffect(() => {
    if (selected >= 0 && selected < options.length) {
      setCurrentSelection(selected)
      setFocusedIndex(selected)
    }
  }, [selected, options])

  // Apply styles when component mounts or styles change
  useEffect(() => {
    if (selectRef.current && styles) {
      const element = selectRef.current
      element.style.backgroundColor = styles.selectBackground ?? ''
      element.style.color = styles.selectForeground ?? ''
      element.style.borderColor = styles.selectBorder ?? ''
    }
  }, [styles])

  // Calculate dropdown width when it becomes visible
  useEffect(() => {
    if (isVisible && dropdownRef.current) {
      const dropdownElement = dropdownRef.current
      const triggerElement = dropdownElement.previousElementSibling as HTMLElement
      
      if (triggerElement) {
        // Get the width of the trigger element
        const triggerWidth = triggerElement.offsetWidth
        
        // Set the dropdown width to match the trigger width
        dropdownElement.style.width = `${triggerWidth}px`
        dropdownElement.style.minWidth = `${triggerWidth}px`
      }
    }
  }, [isVisible])

  // Build CSS classes
  const selectClasses = [
    'monaco-select-box',
    'monaco-select-box-dropdown-padding',
    'setting-control-focus-target',
    isVisible ? 'synthetic-focus' : '',
    className
  ].filter(Boolean).join(' ')

  const dropdownClasses = [
    'monaco-select-box-dropdown-container',
    isVisible ? 'visible' : ''
  ].filter(Boolean).join(' ')

  // Get selected option
  const selectedOption = options[currentSelection] || options[0]

  return (
    <div className="select-container">
      {/* Hidden select element for accessibility */}
      <select
        ref={selectRef}
        id={id}
        className={`${selectClasses} hidden-select`}
        onClick={handleSelectClick}
        onMouseDown={handleSelectMouseDown}
        onKeyDown={handleKeyDown}
        aria-label={selectBoxOptions?.ariaLabel}
        aria-description={selectBoxOptions?.ariaDescription}
        aria-expanded={isVisible}
        tabIndex={0}
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
        className={`${selectClasses} custom-trigger`}
        onClick={handleSelectClick}
        onMouseDown={handleSelectMouseDown}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="combobox"
        aria-expanded={isVisible}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
      >
        <span className="select-text">
          {selectedOption ? selectedOption.text : 'Select...'}
        </span>
        <span className="codicon codicon-chevron-down select-arrow" />
      </div>

      {/* Custom dropdown */}
      {isVisible && (
        <div
          ref={dropdownRef}
          className={`${dropdownClasses} positioned`}
        >
            <ScrollableElement
              options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
              className="select-scrollable-wrapper"
              style={{ maxHeight: '300px', width: '100%', height: '300px' }}
            >
              <div
                id={`${id}-listbox`}
                role="listbox"
                aria-activedescendant={focusedIndex >= 0 ? `${id}-option-${focusedIndex}` : undefined}
                className="select-list-container"
                onKeyDown={handleDropdownKeyDown}
                onWheel={handleWheel}
                tabIndex={0}
              >
              {options.map((option, index) => (
                <div
                  key={index}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === currentSelection}
                  onClick={() => handleOptionClick(index)}
                  className={`select-option ${focusedIndex === index || index === currentSelection ? 'focused' : ''} ${option.isDisabled ? 'disabled' : ''}`}
                  onMouseEnter={() => handleOptionHover(index)}
                >
                  <div className="select-option-content">
                    <div className="select-option-header">
                      <span className="option-text">{option.text}</span>
                      {option.detail && (
                        <span className="option-detail">
                          {option.detail}
                        </span>
                      )}
                    </div>
                  </div>
                  {option.decoratorRight && (
                    <span className="select-option-decorator">
                      {option.decoratorRight}
                    </span>
                  )}
                </div>
                ))}
              </div>
            </ScrollableElement>

          {/* Details pane for descriptions */}
          {options.some(option => option.description) && (
            <div className="select-box-details-pane border-top">
              {selectedOption?.description}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SelectBoxList
