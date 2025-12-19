import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import codiconsMapping from '@vscode/codicons/src/template/mapping.json'
import type { Icon, IconType } from '../../../../types/icon'
import { Button } from '../Button'
import {
  getIconoirNames,
  getPhosphorNames,
  getMdiNames,
  getSimpleIconsNames,
  getFeatherNames,
  getFontAwesomeNames,
  IconoirIcon,
  PhosphorIcon,
  MdiIcon,
  SimpleIcon,
  FeatherIcon,
  FaIcon,
  renderLibraryIcon
} from './iconLibraries'

import './iconSelect.css'

// Get all codicon names from the codicons package
const CODICONS = Object.keys(codiconsMapping).sort()

// Tab types
type TabId = 'emoji' | 'codicon' | 'iconoir' | 'phosphor' | 'material' | 'simpleicons' | 'feather' | 'fontawesome'

interface TabConfig {
  id: TabId
  title: string
  icon: React.ReactNode
  hasSearch: boolean
}

const TABS: TabConfig[] = [
  { id: 'emoji', title: 'Emojis', icon: <span style={{ fontSize: 16 }}>😀</span>, hasSearch: false },
  { id: 'codicon', title: 'Codicons', icon: <i className="codicon codicon-vscode-insiders" style={{ fontSize: 16 }} />, hasSearch: true },
  { id: 'iconoir', title: 'Iconoir', icon: <IconoirIcon name="Iconoir" size={16} />, hasSearch: true },
  { id: 'phosphor', title: 'Phosphor', icon: <PhosphorIcon name="PhosphorLogo" size={16} />, hasSearch: true },
  { id: 'material', title: 'Material', icon: <MdiIcon name="mdiMaterialDesign" size={16} />, hasSearch: true },
  { id: 'simpleicons', title: 'Simple Icons', icon: <SimpleIcon name="siSimpleicons" size={16} />, hasSearch: true },
  { id: 'feather', title: 'Feather', icon: <FeatherIcon name="Feather" size={16} />, hasSearch: true },
  { id: 'fontawesome', title: 'Font Awesome', icon: <FaIcon name="faFontAwesome" size={16} />, hasSearch: true },
]

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

/**
 * SearchInput component for icon filtering
 */
const SearchInput: React.FC<{
  value: string
  onChange: (value: string) => void
  placeholder?: string
}> = ({ value, onChange, placeholder = 'Search...' }) => (
  <div className="ecui-icon-select-search">
    <i className="codicon codicon-search" />
    <input
      type="text"
      value={value}
      onChange={(e) => { onChange(e.target.value) }}
      placeholder={placeholder}
      className="ecui-icon-select-search-input"
      autoFocus
    />
    {value && (
      <button
        type="button"
        className="ecui-icon-select-search-clear"
        onClick={() => { onChange('') }}
      >
        <i className="codicon codicon-close" />
      </button>
    )}
  </div>
)

/**
 * Generic icon grid component
 */
const IconGrid: React.FC<{
  icons: string[]
  renderIcon: (name: string) => React.ReactNode
  onSelect: (name: string) => void
  maxDisplay?: number
}> = ({ icons, renderIcon, onSelect, maxDisplay = 500 }) => {
  const displayedIcons = icons.slice(0, maxDisplay)
  const hasMore = icons.length > maxDisplay
  
  return (
    <div className="ecui-icon-select-library">
      <div className="ecui-icon-select-codicons-grid">
        {displayedIcons.map(name => (
          <button
            key={name}
            type="button"
            className="ecui-icon-select-codicon"
            title={name}
            onClick={() => { onSelect(name) }}
          >
            {renderIcon(name)}
          </button>
        ))}
      </div>
      {hasMore && (
        <div className="ecui-icon-select-more-hint">
          +{icons.length - maxDisplay} more icons. Use search to find specific icons.
        </div>
      )}
    </div>
  )
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
  const [activeTab, setActiveTab] = useState<TabId>('emoji')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => isDarkTheme() ? 'dark' : 'light')
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Search states for each tab
  const [codiconSearch, setCodiconSearch] = useState('')
  const [iconoirSearch, setIconoirSearch] = useState('')
  const [phosphorSearch, setPhosphorSearch] = useState('')
  const [materialSearch, setMaterialSearch] = useState('')
  const [simpleIconsSearch, setSimpleIconsSearch] = useState('')
  const [featherSearch, setFeatherSearch] = useState('')
  const [fontAwesomeSearch, setFontAwesomeSearch] = useState('')

  // Memoized icon lists
  const iconoirNames = useMemo(() => getIconoirNames(), [])
  const phosphorNames = useMemo(() => getPhosphorNames(), [])
  const mdiNames = useMemo(() => getMdiNames(), [])
  const simpleIconsNames = useMemo(() => getSimpleIconsNames(), [])
  const featherNames = useMemo(() => getFeatherNames(), [])
  const fontAwesomeNames = useMemo(() => getFontAwesomeNames(), [])

  // Filtered icon lists
  const filteredCodicons = useMemo(() => {
    if (!codiconSearch) return CODICONS
    const search = codiconSearch.toLowerCase()
    return CODICONS.filter(name => name.toLowerCase().includes(search))
  }, [codiconSearch])

  const filteredIconoir = useMemo(() => {
    if (!iconoirSearch) return iconoirNames
    const search = iconoirSearch.toLowerCase()
    return iconoirNames.filter(name => name.toLowerCase().includes(search))
  }, [iconoirSearch, iconoirNames])

  const filteredPhosphor = useMemo(() => {
    if (!phosphorSearch) return phosphorNames
    const search = phosphorSearch.toLowerCase()
    return phosphorNames.filter(name => name.toLowerCase().includes(search))
  }, [phosphorSearch, phosphorNames])

  const filteredMaterial = useMemo(() => {
    if (!materialSearch) return mdiNames
    const search = materialSearch.toLowerCase()
    return mdiNames.filter(name => name.toLowerCase().includes(search))
  }, [materialSearch, mdiNames])

  const filteredSimpleIcons = useMemo(() => {
    if (!simpleIconsSearch) return simpleIconsNames
    const search = simpleIconsSearch.toLowerCase()
    return simpleIconsNames.filter(name => name.toLowerCase().includes(search))
  }, [simpleIconsSearch, simpleIconsNames])

  const filteredFeather = useMemo(() => {
    if (!featherSearch) return featherNames
    const search = featherSearch.toLowerCase()
    return featherNames.filter(name => name.toLowerCase().includes(search))
  }, [featherSearch, featherNames])

  const filteredFontAwesome = useMemo(() => {
    if (!fontAwesomeSearch) return fontAwesomeNames
    const search = fontAwesomeSearch.toLowerCase()
    return fontAwesomeNames.filter(name => name.toLowerCase().includes(search))
  }, [fontAwesomeSearch, fontAwesomeNames])

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

  // Reset search when tab changes or picker closes
  useEffect(() => {
    if (!isOpen) {
      setCodiconSearch('')
      setIconoirSearch('')
      setPhosphorSearch('')
      setMaterialSearch('')
      setSimpleIconsSearch('')
      setFeatherSearch('')
      setFontAwesomeSearch('')
    }
  }, [isOpen])

  const handleEmojiSelect = useCallback((emojiData: EmojiData) => {
    onChange?.({
      type: 'emoji',
      value: emojiData.native
    })
    setIsOpen(false)
  }, [onChange])

  const handleIconSelect = useCallback((type: IconType, name: string) => {
    onChange?.({
      type,
      value: name
    })
    setIsOpen(false)
  }, [onChange])

  const handleClear = useCallback(() => {
    onChange?.(null)
    setIsOpen(false)
  }, [onChange])

  const displayValue = useMemo(() => {
    if (!value || value.type === 'none') {
      return placeholder ?? <i className="codicon codicon-symbol-misc" style={{ opacity: 0.4 }} />
    }
    if (value.type === 'emoji') {
      return value.value
    }
    if (value.type === 'codicon') {
      return <i className={`codicon codicon-${value.value}`} />
    }
    // Library icons
    return renderLibraryIcon(value.type, value.value, 16)
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
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={`ecui-icon-select-tab ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => { setActiveTab(tab.id) }}
                  title={tab.title}
                >
                  {tab.icon}
                </button>
              ))}
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
              <SearchInput
                value={codiconSearch}
                onChange={setCodiconSearch}
                placeholder="Search codicons..."
              />
              <IconGrid
                icons={filteredCodicons}
                renderIcon={(name) => <i className={`codicon codicon-${name}`} />}
                onSelect={(name) => { handleIconSelect('codicon', name) }}
              />
            </div>
          )}

          {activeTab === 'iconoir' && (
            <div className="ecui-icon-select-codicons">
              <SearchInput
                value={iconoirSearch}
                onChange={setIconoirSearch}
                placeholder="Search Iconoir..."
              />
              <IconGrid
                icons={filteredIconoir}
                renderIcon={(name) => <IconoirIcon name={name} size={16} />}
                onSelect={(name) => { handleIconSelect('iconoir', name) }}
              />
            </div>
          )}

          {activeTab === 'phosphor' && (
            <div className="ecui-icon-select-codicons">
              <SearchInput
                value={phosphorSearch}
                onChange={setPhosphorSearch}
                placeholder="Search Phosphor..."
              />
              <IconGrid
                icons={filteredPhosphor}
                renderIcon={(name) => <PhosphorIcon name={name} size={16} />}
                onSelect={(name) => { handleIconSelect('phosphor', name) }}
              />
            </div>
          )}

          {activeTab === 'material' && (
            <div className="ecui-icon-select-codicons">
              <SearchInput
                value={materialSearch}
                onChange={setMaterialSearch}
                placeholder="Search Material..."
              />
              <IconGrid
                icons={filteredMaterial}
                renderIcon={(name) => <MdiIcon name={name} size={16} />}
                onSelect={(name) => { handleIconSelect('material', name) }}
              />
            </div>
          )}

          {activeTab === 'simpleicons' && (
            <div className="ecui-icon-select-codicons">
              <SearchInput
                value={simpleIconsSearch}
                onChange={setSimpleIconsSearch}
                placeholder="Search Simple Icons..."
              />
              <IconGrid
                icons={filteredSimpleIcons}
                renderIcon={(name) => <SimpleIcon name={name} size={16} />}
                onSelect={(name) => { handleIconSelect('simpleicons', name) }}
              />
            </div>
          )}

          {activeTab === 'feather' && (
            <div className="ecui-icon-select-codicons">
              <SearchInput
                value={featherSearch}
                onChange={setFeatherSearch}
                placeholder="Search Feather..."
              />
              <IconGrid
                icons={filteredFeather}
                renderIcon={(name) => <FeatherIcon name={name} size={16} />}
                onSelect={(name) => { handleIconSelect('feather', name) }}
              />
            </div>
          )}

          {activeTab === 'fontawesome' && (
            <div className="ecui-icon-select-codicons">
              <SearchInput
                value={fontAwesomeSearch}
                onChange={setFontAwesomeSearch}
                placeholder="Search Font Awesome..."
              />
              <IconGrid
                icons={filteredFontAwesome}
                renderIcon={(name) => <FaIcon name={name} size={16} />}
                onSelect={(name) => { handleIconSelect('fontawesome', name) }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default IconSelect
