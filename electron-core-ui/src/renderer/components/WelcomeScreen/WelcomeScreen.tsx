import React from 'react'
import { useTranslation } from 'react-i18next'
import { Wallpaper, type WallpaperPattern } from '../Wallpaper'
import { Wordmark, type WordmarkEffect } from '../Wordmark'
import { FilesPanel } from '../FilesPanel'
import { useFileService } from '../../hooks/useFileService'
import type { VignetteDecoration } from '../Vignette'
import './welcomeScreen.css'

export interface WelcomeScreenProps {
  /**
   * Brand name rendered as the animated wordmark in the header. Also
   * announced (visually hidden) as the page's `<h1>` for screen readers
   * so the wordmark animation stays purely decorative.
   */
  name: string
  /**
   * Action buttons rendered as a centered, vertically-stacked column.
   * Typically two or three `RainbowButton`s (New / Open / Import,
   * etc.) — the screen doesn't impose a count or shape, just laid-out
   * with consistent spacing.
   */
  children?: React.ReactNode
  /**
   * Called when the user activates a file row inside the favorites /
   * recents panel. Passed straight through to `FilesPanel`.
   */
  onOpenFile: (path: string) => void
  /**
   * Optional hint rendered below the action stack when both favorites
   * and recents are empty (e.g. first-run state). Plain string or
   * full ReactNode — consumers handle their own i18n.
   */
  emptyStateHint?: React.ReactNode
  /**
   * Optional confirm hook called before removing a favorite — passed
   * straight through to `FilesPanel`.
   */
  confirmRemoveFavorite?: (fileName: string) => boolean | Promise<boolean>
  /** Wallpaper pattern. Defaults to `'random'`. */
  wallpaperPattern?: WallpaperPattern
  /** Wordmark animation effect. Defaults to `'random'`. */
  wordmarkEffect?: WordmarkEffect
  /** FilesPanel decoration. Defaults to `'random'`. */
  filesPanelDecoration?: VignetteDecoration
  /**
   * Override the `<main>` aria-label. Defaults to the
   * `welcomeScreen.landmarkLabel` translation ("Welcome" / "Accueil").
   */
  ariaLabel?: string
  /** Optional className appended to the root for layout overrides. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id applied to the root. Defaults to `welcome-screen`. */
  'data-testid'?: string
}

/**
 * Empty-state landing surface for an Electron workbench: animated
 * wallpaper, big looped brand wordmark, a stack of CTA buttons supplied
 * via `children`, and a frosted favorites/recents panel pinned to the
 * corner. Reflows top-to-bottom on narrow viewports.
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  name,
  children,
  onOpenFile,
  emptyStateHint,
  confirmRemoveFavorite,
  wallpaperPattern = 'random',
  wordmarkEffect = 'random',
  filesPanelDecoration = 'random',
  ariaLabel,
  className,
  style,
  'data-testid': dataTestId = 'welcome-screen'
}) => {
  const { t } = useTranslation()
  const { recentFiles, favorites } = useFileService()
  const hasContent = recentFiles.length > 0 || favorites.length > 0
  const rootClassName = ['ecu-welcome-screen', className].filter(Boolean).join(' ')

  return (
    <main
      className={rootClassName}
      role="main"
      aria-label={ariaLabel ?? t('welcomeScreen.landmarkLabel')}
      data-testid={dataTestId}
      {...(style ? { style } : {})}
    >
      <Wallpaper pattern={wallpaperPattern} />
      <header className="ecu-welcome-screen-header">
        <h1 className="ecu-welcome-screen-wordmark-heading">
          <span className="ecu-welcome-screen-wordmark-visually-hidden">{name}</span>
          <Wordmark
            effect={wordmarkEffect}
            loop
            className="ecu-welcome-screen-wordmark"
            aria-hidden="true"
          >
            {name}
          </Wordmark>
        </h1>
        <div className="ecu-welcome-screen-rule" aria-hidden="true" />
      </header>
      <div className="ecu-welcome-screen-content">
        <div className="ecu-welcome-screen-actions">{children}</div>
        {!hasContent && emptyStateHint != null && (
          <div className="ecu-welcome-screen-hint">{emptyStateHint}</div>
        )}
      </div>

      <FilesPanel
        onOpenFile={onOpenFile}
        decoration={filesPanelDecoration}
        className="ecu-welcome-screen-files-panel"
        {...(confirmRemoveFavorite ? { confirmRemoveFavorite } : {})}
      />
    </main>
  )
}

export default WelcomeScreen
