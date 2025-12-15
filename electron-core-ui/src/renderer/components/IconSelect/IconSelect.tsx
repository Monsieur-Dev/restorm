import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import codiconsMapping from '@vscode/codicons/src/template/mapping.json'
import type { Icon } from '../../../../types/icon'
import { Button } from '../Button'

import './iconSelect.css'

// Get all codicon names from the official @vscode/codicons package
const CODICONS = Object.keys(codiconsMapping).sort()

export interface IconSelectProps {
  /** Currently selected icon */
  value?: Icon | null
  /** Called when the icon selection changes */
  onChange?: (icon: Icon | null) => void
  /** Placeholder shown when no icon is selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Readonly mode: just display the icon without interaction */
  readonly?: boolean
  className?: string
  style?: React.CSSProperties
}

interface EmojiData {
  native: string
  id: string
  shortcodes?: string
}

/**
 * Detect if the current theme is dark based on data-theme attribute
 */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true
  const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
  return themeAttr === 'dark' || themeAttr === 'hcDark'
}

export const IconSelect: React.FC<IconSelectProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  readonly = false,
  className,
  style
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'emoji' | 'codicon'>('emoji')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => isDarkTheme() ? 'dark' : 'light')
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Calculate picker position when opening
  const updatePickerPosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setPickerPosition({
      top: rect.bottom + 4,
      left: rect.left
    })
  }, [])

  // Watch for theme changes
  useEffect(() => {
    if (typeof document === 'undefined') return

    const handleThemeChange = (): void => {
      setTheme(isDarkTheme() ? 'dark' : 'light')
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          handleThemeChange()
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  // Close picker when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        pickerRef.current &&
        !pickerRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleEmojiSelect = useCallback((emojiData: EmojiData) => {
    onChange?.({
      type: 'emoji',
      value: emojiData.native
    })
    setIsOpen(false)
  }, [onChange])

  const handleCodiconSelect = useCallback((codiconName: string) => {
    onChange?.({
      type: 'codicon',
      value: codiconName
    })
    setIsOpen(false)
  }, [onChange])

  const handleClear = useCallback(() => {
    onChange?.(null)
    setIsOpen(false)
  }, [onChange])

  const displayValue = useMemo(() => {
    if (!value || value.type === 'none') {
      // Show placeholder or a subtle icon when empty
      return placeholder ?? <i className="codicon codicon-symbol-misc" style={{ opacity: 0.4 }} />
    }
    if (value.type === 'emoji') {
      return value.value
    }
    // Codicon: render as icon
    return <i className={`codicon codicon-${value.value}`} />
  }, [value, placeholder])

  const rootClassName = useMemo(
    () => ['ecui-icon-select', readonly ? 'readonly' : '', className].filter(Boolean).join(' '),
    [className, readonly]
  )

  const handleButtonClick = useCallback(() => {
    if (readonly) return
    if (!isOpen) {
      updatePickerPosition()
    }
    setIsOpen(!isOpen)
  }, [isOpen, updatePickerPosition, readonly])

  // Readonly mode: just display the icon
  if (readonly) {
    // Don't render anything if no value in readonly mode
    if (!value || value.type === 'none') {
      return null
    }
    return (
      <span className={rootClassName} style={style}>
        <span className="ecui-icon-select-value">{displayValue}</span>
      </span>
    )
  }

  return (
    <div ref={containerRef} className={rootClassName} style={style}>
      <button
        ref={buttonRef}
        type="button"
        className="ecui-icon-select-button"
        disabled={disabled}
        onClick={handleButtonClick}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className="ecui-icon-select-value">{displayValue}</span>
      </button>

      {isOpen && (
        <div
          ref={pickerRef}
          className="ecui-icon-select-picker"
          style={{
            position: 'fixed',
            top: pickerPosition.top,
            left: pickerPosition.left
          }}
        >
          <div className="ecui-icon-select-header">
            <div className="ecui-icon-select-tabs">
              <button
                type="button"
                className={`ecui-icon-select-tab ${activeTab === 'emoji' ? 'active' : ''}`}
                onClick={() => { setActiveTab('emoji') }}
                title="Emojis"
              >
                <span style={{ fontSize: 16 }}>😀</span>
              </button>
              <button
                type="button"
                className={`ecui-icon-select-tab ${activeTab === 'codicon' ? 'active' : ''}`}
                onClick={() => { setActiveTab('codicon') }}
                title="Codicons"
              >
                <i className="codicon codicon-vscode-insiders" style={{ fontSize: 16 }} />
              </button>
            </div>
            <Button small secondary onClick={handleClear}>
              <i className="codicon codicon-trash" />
            </Button>
          </div>
          
          {activeTab === 'emoji' && (
            <Picker
              data={data}
              onEmojiSelect={handleEmojiSelect}
              theme={theme}
              previewPosition="none"
              skinTonePosition="none"
              emojiButtonColors={[]}
            />
          )}
          
          {activeTab === 'codicon' && (
            <div className="ecui-icon-select-codicons">
              <div className="ecui-icon-select-codicons-grid">
                {CODICONS.map(name => (
                  <button
                    key={name}
                    type="button"
                    className="ecui-icon-select-codicon"
                    title={name}
                    onClick={() => { handleCodiconSelect(name) }}
                  >
                    <i className={`codicon codicon-${name}`} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default IconSelect
