import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useThemeContext } from '../../contexts/useThemeContext'
import type { ThemeInfo, ThemeVariables } from '../../../types/theme'
import { setPendingThemeRevealOrigin } from '../../utils/themeReveal'
import { ScrollableElement } from '../ScrollableElement'
import './settings.css'

interface ThemeCarouselProps {
  className?: string
  /** Optional test id applied to the root element. Defaults to `theme-carousel`. */
  'data-testid'?: string
  /** Optional test id applied to the ScrollableElement. Defaults to `{data-testid}-scrollable`. */
  scrollableTestId?: string
  /**
   * Override what happens when a theme tile is clicked. By default
   * the carousel calls `window.api.theme.set` directly through the
   * theme context. The Settings UI passes a callback so the choice
   * routes through the scope-aware `setSetting` /
   * `setWorkspaceSetting` flow instead — without that override, a
   * theme picked from the Workspace tab never lands in
   * the host's workspace settings file.
   */
  onSelect?: (themeId: string) => void
}

type ThemeTypeOrder = 'dark' | 'hcDark' | 'light' | 'hcLight'

const THEME_TYPE_ORDER: Record<ThemeTypeOrder, number> = {
  dark: 0,
  hcDark: 1,
  light: 2,
  hcLight: 3
}

type ThemePreviewVariables = Record<string, ThemeVariables>

// The preview vignette must render each theme's OWN colours and must NEVER
// inherit the currently-applied theme. A theme's resolved variables can
// legitimately omit a token (e.g. a light theme that doesn't redefine
// `sideBar.background`). Left unset on the tile, `var(--sideBar-background)`
// falls through to the document `:root` — i.e. the ACTIVE theme — so the fake
// sidebar would change colour when you switch the app theme. To prevent any
// such leak, we pin every token the vignette reads onto the tile itself,
// deriving any the theme omits from a sibling token OF THE SAME THEME. Each
// entry is `[target, ...fallbacks]`, resolved top-down so earlier fills feed
// later ones.
const PREVIEW_TOKEN_FALLBACKS: readonly (readonly [string, ...string[]])[] = [
  ['--editor-background', '--editorWidget-background'],
  ['--editorWidget-background', '--editor-background'],
  ['--sideBar-background', '--editorWidget-background', '--editor-background'],
  ['--foreground', '--editor-foreground'],
  ['--editor-foreground', '--foreground'],
  ['--button-background', '--focusBorder', '--foreground'],
  ['--button-secondaryBackground', '--editorWidget-background', '--button-background'],
  ['--editorWidget-border', '--focusBorder'],
  ['--focusBorder', '--button-background', '--foreground']
]

/**
 * Build the tile's inline CSS-variable style from a theme's resolved variables,
 * pinning every vignette token to a same-theme value so none inherits `:root`.
 */
const buildPreviewStyle = (variables: ThemeVariables | undefined): CSSProperties => {
  if (!variables) return {}
  const style: Record<string, string> = { ...(variables as Record<string, string>) }
  for (const entry of PREVIEW_TOKEN_FALLBACKS) {
    const [target, ...fallbacks] = entry
    if (style[target]) continue
    for (const key of fallbacks) {
      if (style[key]) {
        style[target] = style[key]
        break
      }
    }
  }
  return style as CSSProperties
}

export const ThemeCarousel: React.FC<ThemeCarouselProps> = ({
  className,
  'data-testid': dataTestId,
  scrollableTestId,
  onSelect
}) => {
  const { themes, currentThemeId, setTheme, isLoading } = useThemeContext()
  const rootTestId = dataTestId ?? 'theme-carousel'
  const scrollableId = scrollableTestId ?? `${rootTestId}-scrollable`
  const scrollContentRef = useRef<HTMLDivElement | null>(null)
  const selectedTileRef = useRef<HTMLButtonElement | null>(null)
  const [previewVariables, setPreviewVariables] = useState<ThemePreviewVariables>({})

  const sortedThemes: ThemeInfo[] = useMemo(() => {
    return [...themes].sort((a, b) => {
      const orderA = (a.type in THEME_TYPE_ORDER) ? THEME_TYPE_ORDER[a.type as ThemeTypeOrder] : 99
      const orderB = (b.type in THEME_TYPE_ORDER) ? THEME_TYPE_ORDER[b.type as ThemeTypeOrder] : 99
      if (orderA !== orderB) return orderA - orderB
      return a.name.localeCompare(b.name)
    })
  }, [themes])

  // Load CSS variables for theme previews (without applying globally)
  useEffect(() => {
    if (sortedThemes.length === 0) return

    let isCancelled = false

    const loadVariables = async (): Promise<void> => {
      const missingThemeIds = sortedThemes
        .map(theme => theme.id)
        .filter(id => !previewVariables[id])

      if (missingThemeIds.length === 0) return

      try {
        const results = await Promise.all(
          missingThemeIds.map(async (themeId) => {
            try {
              const data: { variables: ThemeVariables } | null = await window.api.theme.load(themeId)
              return data ? [themeId, data.variables] as const : null
            } catch {
              // Ignore load errors for preview purposes
              return null
            }
          })
        )

        if (isCancelled) return

        const next: ThemePreviewVariables = { ...previewVariables }
        for (const entry of results) {
          if (!entry) continue
          const [id, vars] = entry
          next[id] = vars
        }

        setPreviewVariables(next)
      } catch {
        // Silent failure is acceptable for previews
      }
    }

    void loadVariables()

    return () => {
      isCancelled = true
    }
  }, [sortedThemes, previewVariables])

  // Automatically scroll to the selected theme if it is not fully visible
  useEffect(() => {
    if (isLoading) return
    const container = scrollContentRef.current
    const selectedTile = selectedTileRef.current
    if (!container || !selectedTile) return

    const containerRect = container.getBoundingClientRect()
    const tileRect = selectedTile.getBoundingClientRect()

    const fullyVisible =
      tileRect.left >= containerRect.left &&
      tileRect.right <= containerRect.right

    if (!fullyVisible) {
      const offset =
        tileRect.left -
        containerRect.left -
        (containerRect.width - tileRect.width) / 2

      container.scrollTo({
        left: container.scrollLeft + offset,
        behavior: 'smooth'
      })
    }
  }, [currentThemeId, isLoading, sortedThemes.length])

  const handleSelectTheme = (themeId: string, event: React.MouseEvent<HTMLButtonElement>): void => {
    // Anchor the circular reveal at the click point. Pointer-driven clicks
    // expose `clientX`/`clientY`; keyboard activations land at (0, 0) with
    // the synthetic event, in which case we fall back to the tile center
    // so the reveal still feels grounded in the picked tile.
    const fromCursor = event.clientX !== 0 || event.clientY !== 0
    const origin: { x: number; y: number } = fromCursor
      ? { x: event.clientX, y: event.clientY }
      : (() => {
          const rect = event.currentTarget.getBoundingClientRect()
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        })()
    // Two paths reach the visible apply: the carousel's default `setTheme`
    // (direct), and the Settings renderer's `onSelect` override which
    // round-trips through the settings IPC and lands back as a
    // `theme:changed` broadcast inside ThemeContext. Pass the origin to
    // the direct path AND stash it on the module-level pending slot so
    // the broadcast listener can pick it up too.
    setPendingThemeRevealOrigin(origin)
    if (onSelect) {
      onSelect(themeId)
      return
    }
    void setTheme(themeId, origin)
  }

  if (sortedThemes.length === 0) {
    return null
  }

  return (
    <div
      className={`theme-carousel ${className ?? ''}`.trim()}
      data-testid={rootTestId}
      data-theme-count={String(sortedThemes.length)}
      data-selected-theme-id={currentThemeId ?? ''}
    >
      <ScrollableElement
        data-testid={scrollableId}
        options={{
          horizontal: 'visible',
          vertical: 'hidden',
          mouseWheelHorizontal: true
        }}
        className="theme-carousel-scroll-container"
        contentClassName="theme-carousel-scroll-content"
        contentRef={scrollContentRef}
      >
        <div className="theme-carousel-list">
          {sortedThemes.map((theme) => {
            const isSelected = theme.id === currentThemeId
            const style = buildPreviewStyle(previewVariables[theme.id])

            return (
              <button
                key={theme.id}
                type="button"
                ref={isSelected ? selectedTileRef : null}
                className={`theme-carousel-item${isSelected ? ' theme-carousel-item--selected' : ''}`}
                style={style}
                aria-pressed={isSelected}
                onClick={(event) => { handleSelectTheme(theme.id, event) }}
              >
                {/* Abstract "mini-screenshot" of the app, not a functional
                    mockup: every element below is a plain, non-interactive
                    <div>/<span> styled with the theme's real colour tokens —
                    no ECUI control, no tabIndex, no click handler. The card
                    <button> above stays the only focusable/clickable element
                    per tile; the theme name is the only real text. */}
                <div className="theme-carousel-item-preview">
                  <div className="theme-carousel-item-preview-sidebar">
                    <span className="theme-carousel-item-preview-sidebar-item" />
                    <span className="theme-carousel-item-preview-sidebar-item" />
                    <span className="theme-carousel-item-preview-sidebar-item" />
                  </div>
                  <div className="theme-carousel-item-preview-main">
                    <div className="theme-carousel-item-preview-title">{theme.name}</div>

                    <div className="theme-carousel-item-preview-paragraph">
                      <div className="theme-carousel-item-preview-lead">
                        <span className="theme-carousel-item-preview-accent" />
                        <span className="theme-carousel-item-preview-line" />
                      </div>
                      <span className="theme-carousel-item-preview-line" />
                      <span className="theme-carousel-item-preview-line" />
                    </div>

                    <div className="theme-carousel-item-preview-paragraph theme-carousel-item-preview-paragraph--plain">
                      <span className="theme-carousel-item-preview-line" />
                      <span className="theme-carousel-item-preview-line" />
                      <span className="theme-carousel-item-preview-line" />
                    </div>

                    <div className="theme-carousel-item-preview-spacer" />
                    <div className="theme-carousel-item-preview-actions">
                      <span className="theme-carousel-item-preview-button theme-carousel-item-preview-button--primary" />
                      <span className="theme-carousel-item-preview-button theme-carousel-item-preview-button--secondary" />
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </ScrollableElement>
    </div>
  )
}
