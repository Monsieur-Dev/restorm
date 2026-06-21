import React from 'react'
import { useTranslation } from 'react-i18next'
import { Wallpaper, type WallpaperPattern } from '../Wallpaper'
import { Wordmark, type WordmarkEffect } from '../Wordmark'
import { RecentFilesVignette } from '../RecentFilesVignette'
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
   * Typically two or three `<Button appearance="rainbow" size="xl">`
   * (New / Open / Import, etc.) — the screen doesn't impose a count
   * or shape, just laid-out with consistent spacing.
   */
  children?: React.ReactNode
  /**
   * Called when the user activates a file row inside the favorites /
   * recents panel. Passed straight through to `RecentFilesVignette`.
   */
  onOpenFile: (path: string) => void
  /**
   * Optional confirm hook called before removing a favorite — passed
   * straight through to `RecentFilesVignette`.
   */
  confirmRemoveFavorite?: (fileName: string) => boolean | Promise<boolean>
  /** Wallpaper pattern. Defaults to `'random'`. */
  wallpaperPattern?: WallpaperPattern
  /** Wordmark animation effect. Defaults to `'random'`. */
  wordmarkEffect?: WordmarkEffect
  /**
   * Delay in ms before the wordmark plays its first animation. The
   * welcome surface renders empty during the delay so the entrance
   * lands a moment after the user notices the page. Defaults to
   * `2000` (2 s) — pass `0` to disable.
   */
  wordmarkStartDelay?: number
  /** RecentFilesVignette decoration. Defaults to `'random'`. */
  recentFilesVignetteDecoration?: VignetteDecoration
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
  confirmRemoveFavorite,
  wallpaperPattern = 'random',
  wordmarkEffect = 'random',
  wordmarkStartDelay = 2000,
  recentFilesVignetteDecoration = 'random',
  ariaLabel,
  className,
  style,
  'data-testid': dataTestId = 'welcome-screen'
}) => {
  const { t } = useTranslation()
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
          <span aria-hidden="true">
            <Wordmark
              effect={wordmarkEffect}
              loop
              startDelay={wordmarkStartDelay}
              className="ecu-welcome-screen-wordmark"
            >
              {name}
            </Wordmark>
          </span>
        </h1>
        <div className="ecu-welcome-screen-rule" aria-hidden="true" />
      </header>
      <div className="ecu-welcome-screen-content">
        <div className="ecu-welcome-screen-actions">{children}</div>
      </div>

      <RecentFilesVignette
        onOpenFile={onOpenFile}
        decoration={recentFilesVignetteDecoration}
        className="ecu-welcome-screen-recent-files-vignette"
        {...(confirmRemoveFavorite ? { confirmRemoveFavorite } : {})}
      />
    </main>
  )
}

export default WelcomeScreen
