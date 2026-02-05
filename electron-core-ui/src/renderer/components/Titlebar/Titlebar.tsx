import React, { useEffect, useState } from 'react'
import './titlebar.css'
import { TitlebarProps } from './types'
import { CustomWCO } from '../CustomWCO'
import { SearchBar } from '../SearchBar'

const Titlebar: React.FC<TitlebarProps> = ({
  icon,
  title,
  leftContent,
  rightContent,
  centerContent,
  children,  // Deprecated: use leftContent instead
  className = '',
  id,
  'data-testid': dataTestId,
  showSearchBar = false,
  onSearchResultClick,
  renderSearchTooltipContent,
  renderSearchBadge,
  searchFn,
  searchBarTestId,
  customWcoTestId,
  customWcoPlatform
}) => {
  const rootTestId = dataTestId ?? 'titlebar'
  const leftZoneTestId = `${rootTestId}-left`
  const centerZoneTestId = `${rootTestId}-center`
  const rightZoneTestId = `${rootTestId}-right`
  const iconTestId = `${rootTestId}-icon`
  const titleTestId = `${rootTestId}-title`
  const derivedSearchBarTestId = searchBarTestId ?? `${rootTestId}-searchbar`
  const derivedCustomWcoTestId = customWcoTestId ?? `${rootTestId}-customwco`

  const titlebarClasses = [
    'titlebar',
    className
  ].filter(Boolean).join(' ')

  // State for app icon
  const [appIconPath, setAppIconPath] = useState<string | undefined>(undefined)

  // Fetch app icon if no custom icon is provided
  useEffect(() => {
    if (icon) return
    if (typeof window === 'undefined') return

    const anyWindow = window as unknown as { api?: { getWindowIcon?: () => Promise<string | undefined> } }
    const api = anyWindow.api
    if (!api?.getWindowIcon) {
      return
    }

    api
      .getWindowIcon()
      .then((path) => {
        setAppIconPath(path)
      })
      .catch(() => {
        // Ignore errors when fetching app icon in non-Electron/web environments
      })
  }, [icon])

  // Render icon
  const renderIcon = (): React.JSX.Element | null => {
    const actualIcon = icon ?? appIconPath
    if (!actualIcon) return null
    
    if (typeof actualIcon === 'string') {
      if (actualIcon.trim() === '') return null
      return (
        <div className="titlebar-icon" data-testid={iconTestId}>
          <img src={actualIcon} alt="" />
        </div>
      )
    }
    
    return (
      <div className="titlebar-icon" data-testid={iconTestId}>
        {actualIcon}
      </div>
    )
  }

  // Use leftContent if provided, otherwise fall back to children for backward compatibility
  const actualLeftContent = leftContent ?? children

  return (
    <div
      id={id}
      className={titlebarClasses}
      data-testid={rootTestId}
      data-show-searchbar={showSearchBar ? 'true' : 'false'}
      data-has-icon={icon ? 'true' : 'false'}
      data-has-left={actualLeftContent ? 'true' : 'false'}
      data-has-center={(centerContent ?? title) ? 'true' : 'false'}
      data-has-right={rightContent ? 'true' : 'false'}
      style={{
        width: '100%',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box'
      }}
    >
      {/* Left zone */}
      <div className="titlebar-left" data-testid={leftZoneTestId}>
        {renderIcon()}
        {actualLeftContent}
      </div>
      
      {/* Center zone */}
      <div className="titlebar-center" data-testid={centerZoneTestId}>
        {showSearchBar ? (
          <SearchBar
            data-testid={derivedSearchBarTestId}
            title={title}
            onResultClick={onSearchResultClick}
            {...(searchFn ? { searchFn } : {})}
            {...(renderSearchTooltipContent ? { renderTooltipContent: renderSearchTooltipContent } : {})}
            {...(renderSearchBadge ? { renderBadge: renderSearchBadge } : {})}
          />
        ) : (
          centerContent ?? <span className="titlebar-title" data-testid={titleTestId}>{title}</span>
        )}
      </div>
      
      {/* Right zone */}
      <div className="titlebar-right" data-testid={rightZoneTestId}>
        {rightContent}
      </div>
      
      <CustomWCO data-testid={derivedCustomWcoTestId} {...(customWcoPlatform ? { platform: customWcoPlatform } : {})} />
    </div>
  )
}

export default Titlebar
