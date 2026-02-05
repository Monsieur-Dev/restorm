import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useThemeContext } from '../../contexts/useThemeContext'
import type { ThemeInfo, ThemeVariables } from '../../../../types/theme'
import { Button } from '../Button'
import { Toggle } from '../Toggle'
import { InputBox } from '../InputBox'
import { ScrollableElement } from '../ScrollableElement'
import CustomDropdown from '../CustomDropdown'
import './settings.css'

interface ThemeCarouselProps {
  className?: string
  /** Optional test id applied to the root element. Defaults to `theme-carousel`. */
  'data-testid'?: string
  /** Optional test id applied to the ScrollableElement. Defaults to `{data-testid}-scrollable`. */
  scrollableTestId?: string
}

type ThemeTypeOrder = 'dark' | 'hcDark' | 'light' | 'hcLight'

const THEME_TYPE_ORDER: Record<ThemeTypeOrder, number> = {
  dark: 0,
  hcDark: 1,
  light: 2,
  hcLight: 3
}

type ThemePreviewVariables = Record<string, ThemeVariables>

const BEATLES_OPTIONS = [
  { value: 'john', label: 'John Lennon' },
  { value: 'paul', label: 'Paul McCartney' },
  { value: 'george', label: 'George Harrison' },
  { value: 'ringo', label: 'Ringo Starr' }
] as const

export const ThemeCarousel: React.FC<ThemeCarouselProps> = ({
  className,
  'data-testid': dataTestId,
  scrollableTestId
}) => {
  const { themes, currentThemeId, setTheme, isLoading } = useThemeContext()
  const rootTestId = dataTestId ?? 'theme-carousel'
  const scrollableId = scrollableTestId ?? `${rootTestId}-scrollable`
  const scrollContentRef = useRef<HTMLDivElement | null>(null)
  const selectedTileRef = useRef<HTMLButtonElement | null>(null)
  const [previewVariables, setPreviewVariables] = useState<ThemePreviewVariables>({})
  const [selectedBeatle, setSelectedBeatle] = useState<string>('john')

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

  const handleSelectTheme = (themeId: string): void => {
    void setTheme(themeId)
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
            const variables = previewVariables[theme.id]
            const style: CSSProperties = variables ? (variables as CSSProperties) : {}

            return (
              <button
                key={theme.id}
                type="button"
                ref={isSelected ? selectedTileRef : null}
                className={`theme-carousel-item${isSelected ? ' theme-carousel-item--selected' : ''}`}
                style={style}
                onClick={() => { handleSelectTheme(theme.id) }}
              >
                <div className="theme-carousel-item-header">
                  <div className="theme-carousel-item-title">
                    <span className="theme-carousel-item-name">{theme.name}</span>
                    <span className={`theme-carousel-item-type theme-carousel-item-type--${theme.type}`}>
                      {theme.type}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="theme-carousel-item-selected-indicator" aria-label="Selected theme" />
                  )}
                </div>

                <div className="theme-carousel-item-body">
                  <div className="theme-carousel-row">
                    <span className="theme-carousel-label">Actions</span>
                    <div className="theme-carousel-row-buttons">
                      <Button>
                        Primary
                      </Button>
                      <Button secondary>
                        Secondary
                      </Button>
                    </div>
                  </div>

                  <div className="theme-carousel-row">
                    <span className="theme-carousel-label">Toggle</span>
                    <Toggle isChecked>
                      Enabled
                    </Toggle>
                  </div>

                  <div className="theme-carousel-row">
                    <span className="theme-carousel-label">Input</span>
                    <InputBox
                      value="Sample"
                      options={{
                        placeholder: 'Search...',
                        ariaLabel: 'Theme preview input'
                      }}
                    />
                  </div>

                  <div className="theme-carousel-row">
                    <span className="theme-carousel-label">Band</span>
                    <CustomDropdown
                      id={`theme-beatles-${theme.id}`}
                      value={selectedBeatle}
                      options={BEATLES_OPTIONS as unknown as { value: string; label: React.ReactNode }[]}
                      onChange={setSelectedBeatle}
                    />
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

export default ThemeCarousel
