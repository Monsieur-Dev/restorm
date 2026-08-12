import React, { useRef, useEffect, useCallback } from 'react'
import { isMacintosh } from '../../hooks/usePlatform'
import { SelectBoxNativeProps } from './types'
import './selectBox.css'

const SelectBoxNative: React.FC<SelectBoxNativeProps> = ({
  options,
  selected,
  onDidSelect,
  selectBoxOptions,
  styles,
  className,
  id,
  'data-testid': dataTestId,
  disabled = false
}) => {
  const testId = dataTestId ?? id
  const selectRef = useRef<HTMLSelectElement>(null)

  // Handle selection change
  const handleChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const index = event.target.selectedIndex
    const value = event.target.value
    
    onDidSelect({
      selected: value,
      index
    })
    
    // Set title for accessibility
    if (options[index]) {
      event.target.title = options[index].text
    }
  }, [options, onDidSelect])

  // Handle click events
  const handleClick = useCallback((event: React.MouseEvent<HTMLSelectElement>) => {
    // Prevent event propagation to avoid conflicts
    event.stopPropagation()
  }, [])

  // Handle key down events
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLSelectElement>) => {
    let showSelect = false

    if (isMacintosh) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ') {
        showSelect = true
      }
    } else {
      if ((event.key === 'ArrowDown' && event.altKey) || event.key === ' ' || event.key === 'Enter') {
        showSelect = true
      }
    }

    if (showSelect) {
      // Space, Enter is used to expand select box, do not propagate it
      event.stopPropagation()
    }
  }, [])

  // Apply styles when component mounts or styles change
  useEffect(() => {
    if (selectRef.current) {
      const element = selectRef.current
      element.style.backgroundColor = styles.selectBackground ?? ''
      element.style.color = styles.selectForeground ?? ''
      element.style.borderColor = styles.selectBorder ?? ''
    }
  }, [styles])

  // Update selected value when selected prop changes
  useEffect(() => {
    if (selectRef.current && selected >= 0 && selected < options.length) {
      selectRef.current.selectedIndex = selected
      selectRef.current.title = options[selected]?.text ?? ''
    }
  }, [selected, options])

  // Build CSS classes
  const selectClasses = [
    'select-box',
    className
  ].filter(Boolean).join(' ')

  return (
    <div
      className="select-container"
      data-testid={testId}
      data-selected-index={String(selected)}
      data-selected-value={options[selected]?.text ?? ''}
    >
      <select
        ref={selectRef}
        id={id}
        className={selectClasses}
        onChange={handleChange}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={selectBoxOptions.ariaLabel}
        aria-description={selectBoxOptions.ariaDescription}
        disabled={disabled}
        data-testid={`${testId}-native`}
        data-selected-index={String(selected)}
        data-selected-value={options[selected]?.text ?? ''}
      >
        {options.map((option, index) => (
          <option
            key={`${option.text}::${index}`}
            value={option.text}
            disabled={option.isDisabled}
          >
            {option.text}
          </option>
        ))}
      </select>
    </div>
  )
}

export { SelectBoxNative }
