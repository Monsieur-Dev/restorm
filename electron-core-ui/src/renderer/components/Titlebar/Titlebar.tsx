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
  showSearchBar = false,
  onSearchResultClick,
  renderSearchTooltipContent,
  renderSearchBadge
}) => {
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
      return <img src={actualIcon} alt="" className="titlebar-icon" />
    }
    
    return <div className="titlebar-icon">{actualIcon}</div>
  }

  // Use leftContent if provided, otherwise fall back to children for backward compatibility
  const actualLeftContent = leftContent ?? children

  return (
    <div
      id={id}
      className={titlebarClasses}
      style={{
        width: '100%',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box'
      }}
    >
      {/* Left zone */}
      <div className="titlebar-left">
        {renderIcon()}
        {actualLeftContent}
      </div>
      
      {/* Center zone */}
      <div className="titlebar-center">
        {showSearchBar ? (
          <SearchBar
            title={title}
            onResultClick={onSearchResultClick}
            {...(renderSearchTooltipContent ? { renderTooltipContent: renderSearchTooltipContent } : {})}
            {...(renderSearchBadge ? { renderBadge: renderSearchBadge } : {})}
          />
        ) : (
          centerContent ?? <span className="titlebar-title">{title}</span>
        )}
      </div>
      
      {/* Right zone */}
      <div className="titlebar-right">
        {rightContent}
      </div>
      
      <CustomWCO />
    </div>
  )
}

export default Titlebar
