import React, { useEffect, useState } from 'react'
import './titlebar.css'
import { TitlebarProps } from './types'
import { CustomWCO } from '../CustomWCO'
import { SearchBar } from '../SearchBar'
import { NavigationButtons } from './NavigationButtons'
import { useElectronPlatform } from '../../hooks/useElectronPlatform'
import { useNativeAppMenu } from '../../hooks/useNativeAppMenu'
import { logger } from '../../services/logger'

const Titlebar: React.FC<TitlebarProps> = ({
  icon,
  title,
  leftContent,
  rightContent,
  centerContent,
  className = '',
  id,
  'data-testid': dataTestId,
  showSearchBar = false,
  onSearchResultClick,
  renderSearchTooltipContent,
  renderSearchBadge,
  searchBadgedCategories,
  searchFn,
  searchBarTestId,
  searchTooltipHideDelayMs,
  customWcoTestId,
  customWcoPlatform,
  customWcoHoverTooltips,
  showNavigation
}) => {
  const rootTestId = dataTestId ?? 'titlebar'
  const leftZoneTestId = `${rootTestId}-left`
  const centerZoneTestId = `${rootTestId}-center`
  const rightZoneTestId = `${rootTestId}-right`
  const iconTestId = `${rootTestId}-icon`
  const titleTestId = `${rootTestId}-title`
  const derivedSearchBarTestId = searchBarTestId ?? `${rootTestId}-searchbar`
  const derivedCustomWcoTestId = customWcoTestId ?? `${rootTestId}-customwco`

  // Platform from the main process (`process.platform`), the same source the
  // window controls use. On macOS the native traffic lights are drawn over the
  // top-left of the window, so the left zone must reserve room for them.
  const hostPlatform = useElectronPlatform(customWcoPlatform)
  const isMac = hostPlatform === 'darwin'

  const titlebarClasses = [
    'titlebar',
    isMac && 'titlebar--mac',
    className
  ].filter(Boolean).join(' ')

  // State for app icon
  const [appIconPath, setAppIconPath] = useState<string | undefined>(undefined)

  // Expose the titlebar height on document.body so other components
  // (e.g. Toaster) can anchor themselves below the bar without hard-coding
  // the value. Matches the 32px height defined in titlebar.css.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.style.setProperty('--titlebar-height', '32px')
    return () => {
      document.body.style.removeProperty('--titlebar-height')
    }
  }, [])

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
      .catch((error: unknown) => {
        logger.warn('[Titlebar] Failed to fetch window icon', { error: String(error) })
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

  const actualLeftContent = leftContent

  // macOS shows application menus in the system bar, not inside the window.
  // The same JSX drives both, so the two renderings cannot drift apart.
  useNativeAppMenu(actualLeftContent, isMac)

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
    >
      {/* Left zone */}
      <div className="titlebar-left" data-testid={leftZoneTestId}>
        {/* macOS puts the app identity in the system menu bar, not the window
            chrome — and the native traffic lights occupy exactly this spot,
            so rendering an icon here would sit underneath them. */}
        {!isMac && renderIcon()}
        {/* On macOS the menu is published to the system menu bar by
            useNativeAppMenu above, so it is not rendered in the window. */}
        {!isMac && actualLeftContent}
      </div>

      {/* Center zone */}
      <div className="titlebar-center" data-testid={centerZoneTestId}>
        {showNavigation && (
          <NavigationButtons data-testid={`${rootTestId}-nav`} />
        )}
        {showSearchBar ? (
          <SearchBar
            data-testid={derivedSearchBarTestId}
            title={title}
            onResultClick={onSearchResultClick}
            {...(searchFn ? { searchFn } : {})}
            {...(renderSearchTooltipContent ? { renderTooltipContent: renderSearchTooltipContent } : {})}
            {...(renderSearchBadge ? { renderBadge: renderSearchBadge } : {})}
            {...(searchBadgedCategories ? { badgedCategories: searchBadgedCategories } : {})}
            {...(searchTooltipHideDelayMs !== undefined ? { tooltipHideDelayMs: searchTooltipHideDelayMs } : {})}
          />
        ) : (
          centerContent ?? <span className="titlebar-title" data-testid={titleTestId}>{title}</span>
        )}
      </div>

      {/* Right zone */}
      <div className="titlebar-right" data-testid={rightZoneTestId}>
        {rightContent}
      </div>
      
      <CustomWCO
        data-testid={derivedCustomWcoTestId}
        {...(customWcoPlatform ? { platform: customWcoPlatform } : {})}
        {...(customWcoHoverTooltips === false ? { hoverTooltips: false } : {})}
      />
    </div>
  )
}

export { Titlebar }
