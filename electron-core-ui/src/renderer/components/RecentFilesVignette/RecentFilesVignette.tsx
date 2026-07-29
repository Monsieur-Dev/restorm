import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Toggle } from '../Toggle'
import { Tooltip } from '../Tooltip'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { Vignette, type VignetteDecoration } from '../Vignette'
import { ScrollableElement } from '../ScrollableElement'
import { useFileService } from '../../hooks/useFileService'
import './recentFilesVignette.css'

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

/**
 * Cuts a directory into the part that may be elided (`head`, everything up
 * to and including the last separator) and the part that must stay visible
 * (`tail`, the immediate parent folder). `head + tail` re-forms the input
 * exactly. Rendering them as two flex children — head shrinkable with an
 * end-ellipsis, tail unshrinkable — is what produces the middle-ellipsis
 * CSS alone cannot express.
 */
const splitDirectory = (directory: string): { head: string; tail: string } => {
  const lastSep = Math.max(directory.lastIndexOf('/'), directory.lastIndexOf('\\'))
  if (lastSep < 0) return { head: '', tail: directory }
  return {
    head: directory.slice(0, lastSep + 1),
    tail: directory.slice(lastSep + 1)
  }
}

/**
 * The two text lines of a file row: the basename on top, the containing
 * directory muted underneath. Shared by the favorites and the recents
 * list so both stay in lockstep.
 *
 * Hovering a directory that had to be elided reveals the whole absolute
 * path in a tooltip. Truncation is measured on hover rather than on mount
 * so the answer stays right after a window resize without listening for
 * one — the only moment it matters is the moment the pointer arrives.
 */
const FileRowText: React.FC<{ path: string }> = ({ path }) => {
  const { directory, basename } = splitPath(path)
  const { head, tail } = splitDirectory(directory)
  const pathRef = useRef<HTMLSpanElement>(null)
  const headRef = useRef<HTMLSpanElement>(null)
  const [showFullPath, setShowFullPath] = useState(false)

  const handleMouseEnter = useCallback((): void => {
    // The head is the only shrinkable part, so it is where the ellipsis
    // lands: overflowing content there means the line is not showing the
    // whole path.
    const headEl = headRef.current
    setShowFullPath(headEl !== null && headEl.scrollWidth > headEl.clientWidth)
  }, [])
  const handleMouseLeave = useCallback((): void => { setShowFullPath(false) }, [])

  return (
    <div className="ecu-recent-files-vignette-item-text">
      <span className="ecu-recent-files-vignette-item-name">{basename}</span>
      {directory !== '' && (
        <span
          ref={pathRef}
          className="ecu-recent-files-vignette-item-path"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span ref={headRef} className="ecu-recent-files-vignette-item-path-head">{head}</span>
          <span className="ecu-recent-files-vignette-item-path-tail">{tail}</span>
        </span>
      )}
      <Tooltip
        targetRef={pathRef}
        content={path}
        show={showFullPath}
        placement="below"
        data-testid="recent-files-vignette-path-tooltip"
      />
    </div>
  )
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

export interface RecentFilesVignetteProps {
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
   * Optional handler for "open containing folder". When provided, every
   * row gains a right-click context menu offering it; when omitted, no
   * context menu is shown at all. Revealing a path in the OS file manager
   * is a main-process concern, so the panel only reports which file the
   * user asked for and leaves the shell call to the consumer.
   */
  onRevealInFolder?: (path: string) => void
  /**
   * Vignette decoration applied to the frame. Defaults to `'random'`.
   * See the `Vignette` component for the list of built-in decorations.
   */
  decoration?: VignetteDecoration
  /** Optional className appended to the Vignette root for layout overrides. */
  className?: string
  /** Optional inline style overrides on the Vignette root. */
  style?: React.CSSProperties
  /** Optional test id applied to the Vignette root. Defaults to `recent-files-vignette`. */
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
export const RecentFilesVignette: React.FC<RecentFilesVignetteProps> = ({
  onOpenFile,
  confirmRemoveFavorite,
  onRevealInFolder,
  decoration = 'random',
  className,
  style,
  'data-testid': dataTestId = 'recent-files-vignette'
}) => {
  const { t } = useTranslation()
  const { recentFiles, favorites, toggleFavorite } = useFileService()

  // One menu for the whole panel, re-anchored to whichever row was
  // right-clicked — rows are transient (they animate in and out), so
  // hanging a menu off each of them would tie it to a disappearing owner.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const closeContextMenu = useCallback((): void => { setContextMenu(null) }, [])

  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent, path: string): void => {
      if (!onRevealInFolder) return
      event.preventDefault()
      setContextMenu({ x: event.clientX, y: event.clientY, path })
    },
    [onRevealInFolder]
  )

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!onRevealInFolder || !contextMenu) return []
    const { path } = contextMenu
    return [{
      id: 'reveal-in-folder',
      label: t('recentFilesVignette.openContainingFolder'),
      icon: 'folder-opened',
      'data-testid': 'recent-files-vignette-reveal-in-folder',
      onClick: () => { onRevealInFolder(path) }
    }]
  }, [onRevealInFolder, contextMenu, t])

  const askConfirm = useCallback(async (fileName: string): Promise<boolean> => {
    if (confirmRemoveFavorite) return confirmRemoveFavorite(fileName)
    return window.confirm(t('recentFilesVignette.confirmRemoveFavorite', { fileName }))
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

  const panelClassName = ['ecu-recent-files-vignette', className].filter(Boolean).join(' ')

  return (
    <Vignette
      decoration={decoration}
      className={panelClassName}
      data-testid={dataTestId}
      {...(style ? { style } : {})}
    >
      <ScrollableElement
        className="ecu-recent-files-vignette-scroll"
        contentClassName="ecu-recent-files-vignette-scroll-content"
        // `fitContent` keeps the panel sized to its content for short lists and
        // caps + scrolls long ones. The cap is the available height under the
        // title bar: window height minus the title bar + status bar + the
        // panel's own bottom margin / padding (a constant), so it tracks window
        // resizes. `fitContent` reads this max-height from the inline `style`.
        options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, handleMouseWheel: true, fitContent: true }}
        style={{ maxHeight: 'calc(100vh - 174px)' }}
      >
      {hasFavorites && (
        <section
          className="ecu-recent-files-vignette-section ecu-vignette-row"
          data-phase={favoritesPhase}
          aria-label={t('recentFilesVignette.favoritesLandmarkLabel')}
        >
          <div className="ecu-recent-files-vignette-section-inner ecu-vignette-row-inner">
            <h3 className="ecu-recent-files-vignette-section-title">
              <i className="codicon codicon-star-full ecu-recent-files-vignette-section-icon ecu-recent-files-vignette-section-icon--favorite" aria-hidden="true" />
              {t('recentFilesVignette.favorites')}
            </h3>
            <ul className="ecu-recent-files-vignette-list">
              {favoriteItems.map(({ key, item: file, phase }) => (
                <li
                  key={key}
                  className="ecu-recent-files-vignette-item ecu-vignette-row"
                  data-phase={phase}
                >
                  <div
                    className="ecu-recent-files-vignette-item-inner ecu-vignette-row-inner"
                    role="button"
                    tabIndex={0}
                    onClick={() => { onOpenFile(file.path) }}
                    onContextMenu={(e) => { handleRowContextMenu(e, file.path) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenFile(file.path)
                      }
                    }}
                  >
                    <FileRowText path={file.path} />
                    <div
                      className="ecu-recent-files-vignette-toggle-wrap"
                      onClick={(e) => { e.stopPropagation() }}
                      onKeyDown={(e) => { e.stopPropagation() }}
                    >
                      <Toggle
                        appearance="star"
                        checked
                        onChange={() => { handleRemoveFavorite(file.path, file.name) }}
                        actionClassName="ecu-recent-files-vignette-star--active"
                        aria-label={t('recentFilesVignette.removeFromFavorites')}
                        data-testid="recent-files-vignette-remove-favorite-button"
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
          className="ecu-recent-files-vignette-section ecu-vignette-row"
          data-phase={recentsPhase}
          aria-label={t('recentFilesVignette.recentsLandmarkLabel')}
        >
          <div className="ecu-recent-files-vignette-section-inner ecu-vignette-row-inner">
            <h3 className="ecu-recent-files-vignette-section-title">
              <i className="codicon codicon-history ecu-recent-files-vignette-section-icon" aria-hidden="true" />
              {t('recentFilesVignette.recentFiles')}
            </h3>
            <ul className="ecu-recent-files-vignette-list">
              {recentItems.map(({ key, item: file, phase }) => (
                <li
                  key={key}
                  className="ecu-recent-files-vignette-item ecu-vignette-row"
                  data-phase={phase}
                >
                  <div
                    className="ecu-recent-files-vignette-item-inner ecu-vignette-row-inner"
                    role="button"
                    tabIndex={0}
                    onClick={() => { onOpenFile(file.path) }}
                    onContextMenu={(e) => { handleRowContextMenu(e, file.path) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenFile(file.path)
                      }
                    }}
                  >
                    <FileRowText path={file.path} />
                    <div
                      className="ecu-recent-files-vignette-toggle-wrap"
                      onClick={(e) => { e.stopPropagation() }}
                      onKeyDown={(e) => { e.stopPropagation() }}
                    >
                      <Toggle
                        appearance="star"
                        checked={isFavorite(file.path)}
                        onChange={() => { handleToggleFavorite(file.path, file.name, isFavorite(file.path)) }}
                        actionClassName={isFavorite(file.path) ? 'ecu-recent-files-vignette-star--active' : 'ecu-recent-files-vignette-star--reveal-on-hover'}
                        aria-label={isFavorite(file.path) ? t('recentFilesVignette.removeFromFavorites') : t('recentFilesVignette.addToFavorites')}
                        data-testid="recent-files-vignette-toggle-favorite-button"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      </ScrollableElement>
      {contextMenu !== null && createPortal(
        // Portalled to the body on purpose. The menu positions itself with
        // `position: fixed` against viewport coordinates, but the frosted
        // frame above it sets `backdrop-filter`, which makes that frame the
        // containing block for fixed descendants — rendered in place, the
        // menu resolves the pointer's coordinates against the panel instead
        // of the window and lands off-screen. The portal takes it out of the
        // filtered subtree, the same way `Tooltip` escapes it.
        <ContextMenu
          visible
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onRequestClose={closeContextMenu}
          data-testid="recent-files-vignette-context-menu"
        />,
        document.body
      )}
    </Vignette>
  )
}

export default RecentFilesVignette
