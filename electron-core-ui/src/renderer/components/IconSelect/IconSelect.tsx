import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import codiconsMapping from '@vscode/codicons/src/template/mapping.json'
import { EmojiPicker } from './EmojiPicker'
import { GroupedIconPicker } from './GroupedIconPicker'
import { ScrollableElement } from '../ScrollableElement'
import type { Icon, IconType } from '../../../types/icon'
import { IconView } from '../IconView'
import { Button } from '../Button'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import {
  getIconoirNames,
  getPhosphorNames,
  getMdiNames,
  getSimpleIconsNames,
  getFeatherNames,
  getFontAwesomeNames,
} from './iconLibraryUtils'
import {
  IconoirIcon,
  PhosphorIcon,
  MdiIcon,
  SimpleIcon,
  FeatherIcon,
  FaIcon,
} from './iconLibraries'
import {
  CODICON_CATEGORIES,
  FONTAWESOME_CATEGORIES,
  ICONOIR_CATEGORIES,
  PHOSPHOR_CATEGORIES
} from './iconCategories'

import './iconSelect.css'

// Get all codicon names from the codicons package
// In v0.0.44+, mapping.json changed format from { "iconName": codePoint } to { codePoint: ["iconNames"] }
const CODICONS = Object.values(codiconsMapping as Record<string, string[]>)
  .flat()
  .filter((name, index, arr) => arr.indexOf(name) === index) // dedupe
  .sort()

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
  /**
   * Pixel size of the displayed icon. Default `16`. Callers that render
   * the picker next to large typography (e.g. as an H1 adornment) can
   * bump this so the icon visually matches the text without cascading
   * the change into every other IconSelect on the page.
   */
  size?: number
  /**
   * When `true` (default) the trigger uses the `small` button variant
   * — the right sizing for toolbar / statusbar / inline-flow usage.
   * Set to `false` when the icon is rendered at a larger `size`
   * (e.g. 20 px+) so the button's min-height doesn't squash the
   * glyph; pair with a CSS override on the button's horizontal
   * padding if you need a tighter layout.
   */
  small?: boolean
  className?: string
  style?: React.CSSProperties
  /** Optional test id applied to the root element. */
  'data-testid'?: string
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
  placeholder: string
  inputTestId?: string
  clearTestId?: string
}> = ({ value, onChange, placeholder, inputTestId, clearTestId }) => (
  <div className="ecui-icon-select-search">
    <i className="codicon codicon-search" />
    <input
      type="text"
      value={value}
      onChange={(e) => { onChange(e.target.value) }}
      placeholder={placeholder}
      className="ecui-icon-select-search-input"
      {...(inputTestId ? { 'data-testid': inputTestId } : {})}
      autoFocus
    />
    {value && (
      <Button
        line
        icon="close"
        onClick={() => { onChange('') }}
        {...(clearTestId ? { 'data-testid': clearTestId } : {})}
      />
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
  moreHintText?: string
  dataTestIdBase?: string
  iconType?: IconType
}> = ({ icons, renderIcon, onSelect, maxDisplay = 500, moreHintText, dataTestIdBase, iconType }) => {
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
            aria-label={name}
            onClick={() => { onSelect(name) }}
            data-testid={`${dataTestIdBase}-icon-${name}`}
            data-icon-type={iconType}
            data-icon-name={name}
          >
            {renderIcon(name)}
          </button>
        ))}
      </div>
      {hasMore && moreHintText && (
        <div className="ecui-icon-select-more-hint">
          {moreHintText}
        </div>
      )}
    </div>
  )
}

const IconSelectInner: React.FC<IconSelectProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  readonly = false,
  size = 16,
  small = true,
  className,
  style,
  'data-testid': dataTestId
}) => {
  const testId = dataTestId ?? 'iconselect'
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('emoji')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => isDarkTheme() ? 'dark' : 'light')
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLDivElement | null>(null)

  // Register the open picker with the overlay-presence service so a
  // main-process compositor view (the Mini browser's `WebContentsView`)
  // collapses out from under it instead of painting on top of the
  // fixed-position picker. Same hook as the other ECUI popovers.
  useOverlayPresence(pickerRef, isOpen)

  // Search states for tabs without grouping
  const [materialSearch, setMaterialSearch] = useState('')
  const [simpleIconsSearch, setSimpleIconsSearch] = useState('')
  const [featherSearch, setFeatherSearch] = useState('')

  // Close picker and reset search states
  const closeAndReset = useCallback(() => {
    setIsOpen(false)
    setMaterialSearch('')
    setSimpleIconsSearch('')
    setFeatherSearch('')
  }, [])

  // Memoized icon lists
  const iconoirNames = useMemo(() => getIconoirNames(), [])
  const phosphorNames = useMemo(() => getPhosphorNames(), [])
  const mdiNames = useMemo(() => getMdiNames(), [])
  const simpleIconsNames = useMemo(() => getSimpleIconsNames(), [])
  const featherNames = useMemo(() => getFeatherNames(), [])
  const fontAwesomeNames = useMemo(() => getFontAwesomeNames(), [])

  // Filtered icon lists (for tabs without grouping)
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

  // Calculate picker position when opening
  const updatePickerPosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    // Position so the arrow (at 23px from left) points to button center (12px)
    setPickerPosition({
      top: rect.bottom + 12,
      left: rect.left - 11
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
        closeAndReset()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, closeAndReset])

  const handleEmojiSelect = useCallback((emoji: string) => {
    onChange?.({
      type: 'emoji',
      value: emoji
    })
    closeAndReset()
  }, [onChange, closeAndReset])

  const handleIconSelect = useCallback((type: IconType, name: string) => {
    onChange?.({
      type,
      value: name
    })
    closeAndReset()
  }, [onChange, closeAndReset])

  const handleClear = useCallback(() => {
    onChange?.(null)
    closeAndReset()
  }, [onChange, closeAndReset])

  const displayValue = useMemo(() => {
    if (!value || value.type === 'none') {
      return placeholder ?? <i className="codicon codicon-symbol-misc" style={{ opacity: 0.4, fontSize: size }} />
    }
    return <IconView icon={value} size={size} />
  }, [value, placeholder, size])

  const selectedType = value && value.type !== 'none' ? value.type : ''
  const selectedValue = value && value.type !== 'none' ? value.value : ''

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
      <span
        className={rootClassName}
        style={style}
        data-testid={testId}
        data-is-open="false"
        data-disabled={disabled ? 'true' : 'false'}
        data-active-tab={activeTab}
        data-selected-type={selectedType}
        data-selected-value={selectedValue}
      >
        <span className="ecui-icon-select-value" data-testid={`${testId}-value`}>{displayValue}</span>
      </span>
    )
  }

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      style={style}
      data-testid={testId}
      data-is-open={isOpen ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      data-active-tab={activeTab}
      data-selected-type={selectedType}
      data-selected-value={selectedValue}
    >
      <div ref={buttonRef}>
        <Button
          {...(small ? { small: true } : {})}
          secondary
          disabled={disabled}
          onClick={handleButtonClick}
          data-testid={`${testId}-button`}
          style={{ backgroundColor: 'transparent' }}
        >
          <span className="ecui-icon-select-value" data-testid={`${testId}-value`}>{displayValue}</span>
        </Button>
      </div>

      {isOpen && createPortal(
        <div
          ref={pickerRef}
          className="ecui-icon-select-picker"
          data-testid={`${testId}-picker`}
          style={{
            position: 'fixed',
            top: pickerPosition.top,
            left: pickerPosition.left
          }}
        >
          <div className="ecui-icon-select-header" data-testid={`${testId}-header`}>
            <div className="ecui-icon-select-tabs" data-testid={`${testId}-tabs`}>
              {TABS.map(tab => (
                <Button
                  line
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id) }}
                  data-testid={`${testId}-tab-${tab.id}`}
                >
                  {tab.icon}
                </Button>
              ))}
            </div>
            <Button small icon="trash" onClick={handleClear} data-testid={`${testId}-clear`}>
            </Button>
          </div>
          
          {activeTab === 'emoji' && (
            <div data-testid={`${testId}-panel-emoji`}>
              <EmojiPicker
              onEmojiSelect={handleEmojiSelect}
              theme={theme}
              dataTestIdBase={`${testId}-emoji`}
              />
            </div>
          )}
          
          {activeTab === 'codicon' && (
            <div data-testid={`${testId}-panel-codicon`}>
              <GroupedIconPicker
              iconNames={CODICONS}
              categories={CODICON_CATEGORIES}
              renderIcon={(name) => <i className={`codicon codicon-${name}`} />}
              onSelect={(name) => { handleIconSelect('codicon', name) }}
              searchPlaceholder={t('iconSelect.searchCodicons')}
              idPrefix="codicon"
              dataTestIdBase={`${testId}-codicon`}
              iconType="codicon"
              />
            </div>
          )}

          {activeTab === 'iconoir' && (
            <div data-testid={`${testId}-panel-iconoir`}>
              <GroupedIconPicker
              iconNames={iconoirNames}
              categories={ICONOIR_CATEGORIES}
              renderIcon={(name) => <IconoirIcon name={name} size={16} />}
              onSelect={(name) => { handleIconSelect('iconoir', name) }}
              searchPlaceholder={t('iconSelect.searchIconoir')}
              idPrefix="iconoir"
              dataTestIdBase={`${testId}-iconoir`}
              iconType="iconoir"
              />
            </div>
          )}

          {activeTab === 'phosphor' && (
            <div data-testid={`${testId}-panel-phosphor`}>
              <GroupedIconPicker
              iconNames={phosphorNames}
              categories={PHOSPHOR_CATEGORIES}
              renderIcon={(name) => <PhosphorIcon name={name} size={16} />}
              onSelect={(name) => { handleIconSelect('phosphor', name) }}
              searchPlaceholder={t('iconSelect.searchPhosphor')}
              idPrefix="phosphor"
              dataTestIdBase={`${testId}-phosphor`}
              iconType="phosphor"
              />
            </div>
          )}

          {activeTab === 'material' && (
            <div className="ecui-icon-select-codicons" data-testid={`${testId}-panel-material`}>
              <SearchInput
                value={materialSearch}
                onChange={setMaterialSearch}
                placeholder={t('iconSelect.searchMaterial')}
                inputTestId={`${testId}-material-search-input`}
                clearTestId={`${testId}-material-search-clear`}
              />
              <ScrollableElement
                options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
                className="ecui-icon-select-scroll"
                data-testid={`${testId}-material-scroll`}
              >
                <IconGrid
                  icons={filteredMaterial}
                  renderIcon={(name) => <MdiIcon name={name} size={16} />}
                  onSelect={(name) => { handleIconSelect('material', name) }}
                  moreHintText={t('iconSelect.moreIcons', { count: filteredMaterial.length - 500 })}
                  dataTestIdBase={`${testId}-material`}
                  iconType="material"
                />
              </ScrollableElement>
            </div>
          )}

          {activeTab === 'simpleicons' && (
            <div className="ecui-icon-select-codicons" data-testid={`${testId}-panel-simpleicons`}>
              <SearchInput
                value={simpleIconsSearch}
                onChange={setSimpleIconsSearch}
                placeholder={t('iconSelect.searchSimpleIcons')}
                inputTestId={`${testId}-simpleicons-search-input`}
                clearTestId={`${testId}-simpleicons-search-clear`}
              />
              <ScrollableElement
                options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
                className="ecui-icon-select-scroll"
                data-testid={`${testId}-simpleicons-scroll`}
              >
                <IconGrid
                  icons={filteredSimpleIcons}
                  renderIcon={(name) => <SimpleIcon name={name} size={16} />}
                  onSelect={(name) => { handleIconSelect('simpleicons', name) }}
                  moreHintText={t('iconSelect.moreIcons', { count: filteredSimpleIcons.length - 500 })}
                  dataTestIdBase={`${testId}-simpleicons`}
                  iconType="simpleicons"
                />
              </ScrollableElement>
            </div>
          )}

          {activeTab === 'feather' && (
            <div className="ecui-icon-select-codicons" data-testid={`${testId}-panel-feather`}>
              <SearchInput
                value={featherSearch}
                onChange={setFeatherSearch}
                placeholder={t('iconSelect.searchFeather')}
                inputTestId={`${testId}-feather-search-input`}
                clearTestId={`${testId}-feather-search-clear`}
              />
              <ScrollableElement
                options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
                className="ecui-icon-select-scroll"
                data-testid={`${testId}-feather-scroll`}
              >
                <IconGrid
                  icons={filteredFeather}
                  renderIcon={(name) => <FeatherIcon name={name} size={16} />}
                  onSelect={(name) => { handleIconSelect('feather', name) }}
                  moreHintText={t('iconSelect.moreIcons', { count: filteredFeather.length - 500 })}
                  dataTestIdBase={`${testId}-feather`}
                  iconType="feather"
                />
              </ScrollableElement>
            </div>
          )}

          {activeTab === 'fontawesome' && (
            <div data-testid={`${testId}-panel-fontawesome`}>
              <GroupedIconPicker
              iconNames={fontAwesomeNames}
              categories={FONTAWESOME_CATEGORIES}
              renderIcon={(name) => <FaIcon name={name} size={16} />}
              onSelect={(name) => { handleIconSelect('fontawesome', name) }}
              searchPlaceholder={t('iconSelect.searchFontAwesome')}
              idPrefix="fontawesome"
              dataTestIdBase={`${testId}-fontawesome`}
              iconType="fontawesome"
              />
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

export const IconSelect = React.memo(IconSelectInner)
export default IconSelect
