import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileService, Button, RainbowButton, Wallpaper, Vignette, Wordmark } from 'electron-core-ui/renderer'
import './Welcome.css'

const EXIT_MS = 1300

type TransitionPhase = 'present' | 'exit'

interface TransitionEntry<T> {
  key: string
  item: T
  phase: TransitionPhase
}

const splitPath = (fullPath: string): { directory: string; basename: string } => {
  const lastSep = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
  if (lastSep < 0) return { directory: '', basename: fullPath }
  return {
    directory: fullPath.slice(0, lastSep),
    basename: fullPath.slice(lastSep + 1)
  }
}

const getPath = (file: { path: string }): string => file.path

/**
 * Mirrors a list of items but keeps removed entries with phase `exit` for
 * `exitMs` ms before dropping them — so the consumer can run a CSS exit
 * animation before unmount. Pairs with `.ecu-vignette-row` /
 * `.ecu-vignette-row-inner` whose `data-phase="exit"` styling collapses
 * the row + fades out the content.
 */
function useTransitionItems<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  exitMs: number
): readonly TransitionEntry<T>[] {
  const [entries, setEntries] = useState<readonly TransitionEntry<T>[]>(() =>
    items.map((item) => ({ key: keyOf(item), item, phase: 'present' as const }))
  )
  // Reference-track the last `items` reconciled against so the diff runs
  // during render (React's recommended pattern for prop-derived state)
  // instead of via setState-in-effect.
  const [lastItems, setLastItems] = useState(items)

  if (items !== lastItems) {
    setLastItems(items)
    const incomingKeys = new Set(items.map(keyOf))
    const previousByKey = new Map(entries.map((e) => [e.key, e]))
    const next: TransitionEntry<T>[] = []
    for (const e of entries) {
      if (incomingKeys.has(e.key)) {
        const fresh = items.find((i) => keyOf(i) === e.key) as T
        next.push({ key: e.key, item: fresh, phase: 'present' })
      } else if (e.phase === 'exit') {
        next.push(e)
      } else {
        next.push({ ...e, phase: 'exit' })
      }
    }
    for (const item of items) {
      if (!previousByKey.has(keyOf(item))) {
        next.push({ key: keyOf(item), item, phase: 'present' })
      }
    }
    if (!sameTransitionState(entries, next)) {
      setEntries(next)
    }
  }

  useEffect(() => {
    const exitingKeys = entries.filter((e) => e.phase === 'exit').map((e) => e.key)
    if (exitingKeys.length === 0) return undefined
    const timer = window.setTimeout(() => {
      setEntries((prev) => prev.filter((e) => !(e.phase === 'exit' && exitingKeys.includes(e.key))))
    }, exitMs)
    return () => { window.clearTimeout(timer) }
  }, [entries, exitMs])

  return entries
}

function sameTransitionState<T>(
  a: readonly TransitionEntry<T>[],
  b: readonly TransitionEntry<T>[]
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ea = a[i]
    const eb = b[i]
    if (!ea || !eb) return false
    if (ea.key !== eb.key || ea.phase !== eb.phase || ea.item !== eb.item) return false
  }
  return true
}

interface WelcomeProps {
  onNew?: () => void
  onOpen?: () => void
}

/**
 * Empty-state landing of the workbench: a hero with the brand wordmark,
 * the two primary actions (New / Open), and a frosted panel surfacing
 * favorites and recent files.
 */
export const Welcome: React.FC<WelcomeProps> = ({ onNew, onOpen }) => {
  const { t } = useTranslation()
  const {
    recentFiles,
    favorites,
    toggleFavorite
  } = useFileService()

  const handleOpenFile = useCallback((path: string) => {
    // Use restorm:open-path which handles both files and folders
    void window.restorm?.file.openPath(path)
  }, [])

  const handleToggleFavorite = useCallback((path: string, fileName: string, isCurrentlyFavorite: boolean, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent opening the file
    if (isCurrentlyFavorite) {
      const confirmed = window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
      if (!confirmed) return
    }
    void toggleFavorite(path)
  }, [toggleFavorite, t])

  const handleRemoveFavorite = useCallback((path: string, fileName: string, event: React.MouseEvent) => {
    event.stopPropagation()
    const confirmed = window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
    if (confirmed) {
      void toggleFavorite(path)
    }
  }, [toggleFavorite, t])

  const isFavorite = useCallback((path: string): boolean => {
    return favorites.some(f => f.path === path)
  }, [favorites])

  const favoriteItems = useTransitionItems(favorites, getPath, EXIT_MS)
  const recentItems = useTransitionItems(recentFiles, getPath, EXIT_MS)
  const hasFavorites = favoriteItems.length > 0
  const hasRecents = recentItems.length > 0
  const hasContent = hasFavorites || hasRecents
  const favoritesPhase: TransitionPhase = favoriteItems.some((e) => e.phase === 'present')
    ? 'present'
    : 'exit'
  const recentsPhase: TransitionPhase = recentItems.some((e) => e.phase === 'present')
    ? 'present'
    : 'exit'

  return (
    <main
      className="welcome-container"
      role="main"
      aria-label={t('welcome.landmarkLabel')}
    >
      <Wallpaper pattern="random" />
      <header className="welcome-header">
        <h1 className="welcome-wordmark-heading">
          <span className="welcome-wordmark-visually-hidden">Restorm</span>
          <Wordmark
            effect="random"
            loop
            className="welcome-wordmark"
            aria-hidden="true"
          >
            Restorm
          </Wordmark>
        </h1>
        <div className="welcome-wordmark-rule" aria-hidden="true" />
      </header>
      <div className="welcome-content">
        <div className="welcome-actions">
          <RainbowButton
            size="xl"
            onClick={onNew}
            aria-label={t('welcome.newAriaLabel')}
            data-testid="welcome-new-button"
          >
            {t('welcome.new')}
          </RainbowButton>
          <RainbowButton
            size="xl"
            onClick={onOpen}
            aria-label={t('welcome.openAriaLabel')}
            data-testid="welcome-open-button"
          >
            {t('welcome.open')}
          </RainbowButton>
        </div>
        {!hasContent && (
          <p className="welcome-hint">
            {t('welcome.noFilesHint')}
          </p>
        )}
      </div>

      {hasContent && (
        <Vignette decoration="random" className="welcome-files-panel">
          {hasFavorites && (
            <section
              className="welcome-section ecu-vignette-row"
              data-phase={favoritesPhase}
              aria-label={t('welcome.favoritesLandmarkLabel')}
            >
              <div className="welcome-section-inner ecu-vignette-row-inner">
                <h3 className="welcome-section-title">
                  <i className="codicon codicon-star-full welcome-section-icon favorite" aria-hidden="true" />
                  {t('welcome.favorites')}
                </h3>
                <ul className="welcome-file-list">
                  {favoriteItems.map(({ key, item: file, phase }) => (
                    <li
                      key={key}
                      className="welcome-file-item ecu-vignette-row"
                      data-phase={phase}
                    >
                      <div
                        className="welcome-file-item-inner ecu-vignette-row-inner"
                        role="button"
                        tabIndex={0}
                        onClick={() => { handleOpenFile(file.path) }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenFile(file.path) } }}
                      >
                        <span className="welcome-file-name">{splitPath(file.path).basename}</span>
                        <span className="welcome-file-path">{splitPath(file.path).directory}</span>
                        <Button
                          icon="star-full"
                          small
                          secondary
                          className="welcome-favorite-btn is-favorite"
                          onClick={(e) => { handleRemoveFavorite(file.path, file.name, e) }}
                          options={{ title: t('welcome.removeFromFavorites'), ariaLabel: t('welcome.removeFromFavorites') }}
                          data-testid="remove-favorite-button"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {hasRecents && (
            <section
              className="welcome-section ecu-vignette-row"
              data-phase={recentsPhase}
              aria-label={t('welcome.recentsLandmarkLabel')}
            >
              <div className="welcome-section-inner ecu-vignette-row-inner">
                <h3 className="welcome-section-title">
                  <i className="codicon codicon-history welcome-section-icon" aria-hidden="true" />
                  {t('welcome.recentFiles')}
                </h3>
                <ul className="welcome-file-list">
                  {recentItems.map(({ key, item: file, phase }) => (
                    <li
                      key={key}
                      className="welcome-file-item ecu-vignette-row"
                      data-phase={phase}
                    >
                      <div
                        className="welcome-file-item-inner ecu-vignette-row-inner"
                        role="button"
                        tabIndex={0}
                        onClick={() => { handleOpenFile(file.path) }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenFile(file.path) } }}
                      >
                        <span className="welcome-file-name">{splitPath(file.path).basename}</span>
                        <span className="welcome-file-path">{splitPath(file.path).directory}</span>
                        <Button
                          icon={isFavorite(file.path) ? 'star-full' : 'star-empty'}
                          small
                          secondary
                          className={`welcome-favorite-btn ${isFavorite(file.path) ? 'is-favorite' : ''}`}
                          onClick={(e) => { handleToggleFavorite(file.path, file.name, isFavorite(file.path), e) }}
                          options={{
                            title: isFavorite(file.path) ? t('welcome.removeFromFavorites') : t('welcome.addToFavorites'),
                            ariaLabel: isFavorite(file.path) ? t('welcome.removeFromFavorites') : t('welcome.addToFavorites')
                          }}
                          data-testid="toggle-favorite-button"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </Vignette>
      )}
    </main>
  )
}

export default Welcome
