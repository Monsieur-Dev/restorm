import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from '../Toggle'
import { Vignette, type VignetteDecoration } from '../Vignette'
import { useFileService } from '../../hooks/useFileService'
import './filesPanel.css'

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

interface FileLike { path: string; name: string }
const getPath = (file: FileLike): string => file.path

/**
 * Mirrors a list of items but keeps removed entries as `phase: 'exit'`
 * for `exitMs` ms before dropping them — pairs with the
 * `.ecu-vignette-row` / `.ecu-vignette-row-inner` CSS primitive so each
 * removal plays the staggered "fade out → row collapse" animation
 * before unmount, and each addition plays "row expand → fade in".
 */
function useTransitionItems<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  exitMs: number
): readonly TransitionEntry<T>[] {
  const [entries, setEntries] = useState<readonly TransitionEntry<T>[]>(() =>
    items.map((item) => ({ key: keyOf(item), item, phase: 'present' as const }))
  )
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

export interface FilesPanelProps {
  /**
   * Called when the user clicks (or activates with Enter / Space) a
   * file row. The component itself only knows the file's path —
   * dispatching to the right open routine is the consumer's job
   * (typically calling out through a preload bridge / IPC).
   */
  onOpenFile: (path: string) => void
  /**
   * Optional confirm hook called before removing a favorite.
   * Defaults to a synchronous `window.confirm` with a localized
   * message. Return `true` to proceed, `false` to cancel.
   */
  confirmRemoveFavorite?: (fileName: string) => boolean | Promise<boolean>
  /**
   * Vignette decoration applied to the frame. Defaults to `'random'`.
   * See the `Vignette` component for the list of built-in decorations.
   */
  decoration?: VignetteDecoration
  /** Optional className appended to the Vignette root for layout overrides. */
  className?: string
  /** Optional inline style overrides on the Vignette root. */
  style?: React.CSSProperties
  /** Optional test id applied to the Vignette root. Defaults to `files-panel`. */
  'data-testid'?: string
}

/**
 * Frosted-glass panel listing the user's favorites and recent files.
 * Pulls data from `useFileService()`, renders favorites first then
 * recents, and animates additions / removals via the reusable
 * `.ecu-vignette-row` primitive. The frame itself is a `Vignette`
 * (random decoration by default) so consumers get the same look as
 * the rest of the welcome surface.
 *
 * Returns `null` when both lists are empty so the consumer's empty
 * state (if any) shows through cleanly.
 */
export const FilesPanel: React.FC<FilesPanelProps> = ({
  onOpenFile,
  confirmRemoveFavorite,
  decoration = 'random',
  className,
  style,
  'data-testid': dataTestId = 'files-panel'
}) => {
  const { t } = useTranslation()
  const { recentFiles, favorites, toggleFavorite } = useFileService()

  const askConfirm = useCallback(async (fileName: string): Promise<boolean> => {
    if (confirmRemoveFavorite) return confirmRemoveFavorite(fileName)
    return window.confirm(t('filesPanel.confirmRemoveFavorite', { fileName }))
  }, [confirmRemoveFavorite, t])

  const handleToggleFavorite = useCallback(
    (path: string, fileName: string, isCurrentlyFavorite: boolean) => {
      if (isCurrentlyFavorite) {
        void (async () => {
          const confirmed = await askConfirm(fileName)
          if (confirmed) await toggleFavorite(path)
        })()
        return
      }
      void toggleFavorite(path)
    },
    [toggleFavorite, askConfirm]
  )

  const handleRemoveFavorite = useCallback(
    (path: string, fileName: string) => {
      void (async () => {
        const confirmed = await askConfirm(fileName)
        if (confirmed) await toggleFavorite(path)
      })()
    },
    [toggleFavorite, askConfirm]
  )

  const isFavorite = useCallback(
    (path: string): boolean => favorites.some(f => f.path === path),
    [favorites]
  )

  const favoriteItems = useTransitionItems(favorites, getPath, EXIT_MS)
  const recentItems = useTransitionItems(recentFiles, getPath, EXIT_MS)
  const hasFavorites = favoriteItems.length > 0
  const hasRecents = recentItems.length > 0
  if (!hasFavorites && !hasRecents) return null

  const favoritesPhase: TransitionPhase = favoriteItems.some((e) => e.phase === 'present') ? 'present' : 'exit'
  const recentsPhase: TransitionPhase = recentItems.some((e) => e.phase === 'present') ? 'present' : 'exit'

  const panelClassName = ['ecu-files-panel', className].filter(Boolean).join(' ')

  return (
    <Vignette
      decoration={decoration}
      className={panelClassName}
      data-testid={dataTestId}
      {...(style ? { style } : {})}
    >
      {hasFavorites && (
        <section
          className="ecu-files-panel-section ecu-vignette-row"
          data-phase={favoritesPhase}
          aria-label={t('filesPanel.favoritesLandmarkLabel')}
        >
          <div className="ecu-files-panel-section-inner ecu-vignette-row-inner">
            <h3 className="ecu-files-panel-section-title">
              <i className="codicon codicon-star-full ecu-files-panel-section-icon ecu-files-panel-section-icon--favorite" aria-hidden="true" />
              {t('filesPanel.favorites')}
            </h3>
            <ul className="ecu-files-panel-list">
              {favoriteItems.map(({ key, item: file, phase }) => (
                <li
                  key={key}
                  className="ecu-files-panel-item ecu-vignette-row"
                  data-phase={phase}
                >
                  <div
                    className="ecu-files-panel-item-inner ecu-vignette-row-inner"
                    role="button"
                    tabIndex={0}
                    onClick={() => { onOpenFile(file.path) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenFile(file.path)
                      }
                    }}
                  >
                    <span className="ecu-files-panel-item-name">{splitPath(file.path).basename}</span>
                    <span className="ecu-files-panel-item-path">{splitPath(file.path).directory}</span>
                    <div
                      className="ecu-files-panel-toggle-wrap"
                      onClick={(e) => { e.stopPropagation() }}
                      onKeyDown={(e) => { e.stopPropagation() }}
                    >
                      <Toggle
                        appearance="star"
                        checked
                        onChange={() => { handleRemoveFavorite(file.path, file.name) }}
                        actionClassName="ecu-files-panel-star--active"
                        aria-label={t('filesPanel.removeFromFavorites')}
                        data-testid="files-panel-remove-favorite-button"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {hasRecents && (
        <section
          className="ecu-files-panel-section ecu-vignette-row"
          data-phase={recentsPhase}
          aria-label={t('filesPanel.recentsLandmarkLabel')}
        >
          <div className="ecu-files-panel-section-inner ecu-vignette-row-inner">
            <h3 className="ecu-files-panel-section-title">
              <i className="codicon codicon-history ecu-files-panel-section-icon" aria-hidden="true" />
              {t('filesPanel.recentFiles')}
            </h3>
            <ul className="ecu-files-panel-list">
              {recentItems.map(({ key, item: file, phase }) => (
                <li
                  key={key}
                  className="ecu-files-panel-item ecu-vignette-row"
                  data-phase={phase}
                >
                  <div
                    className="ecu-files-panel-item-inner ecu-vignette-row-inner"
                    role="button"
                    tabIndex={0}
                    onClick={() => { onOpenFile(file.path) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenFile(file.path)
                      }
                    }}
                  >
                    <span className="ecu-files-panel-item-name">{splitPath(file.path).basename}</span>
                    <span className="ecu-files-panel-item-path">{splitPath(file.path).directory}</span>
                    <div
                      className="ecu-files-panel-toggle-wrap"
                      onClick={(e) => { e.stopPropagation() }}
                      onKeyDown={(e) => { e.stopPropagation() }}
                    >
                      <Toggle
                        appearance="star"
                        checked={isFavorite(file.path)}
                        onChange={() => { handleToggleFavorite(file.path, file.name, isFavorite(file.path)) }}
                        actionClassName={isFavorite(file.path) ? 'ecu-files-panel-star--active' : 'ecu-files-panel-star--reveal-on-hover'}
                        aria-label={isFavorite(file.path) ? t('filesPanel.removeFromFavorites') : t('filesPanel.addToFavorites')}
                        data-testid="files-panel-toggle-favorite-button"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </Vignette>
  )
}

export default FilesPanel
