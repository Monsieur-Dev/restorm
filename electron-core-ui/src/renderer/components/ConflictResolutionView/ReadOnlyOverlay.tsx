import React, { useCallback } from 'react'
import './readOnlyOverlay.css'

export interface ReadOnlyOverlayProps {
  children: React.ReactNode
  'data-testid'?: string
}

/** Interactions that only NAVIGATE (never mutate) stay allowed: tab strips
 * and collapsible pane headers. A pane header's ACTIONS cluster (add-row
 * buttons and the like) is a mutating surface that happens to live inside
 * the header — the blocked-selector carve-out keeps it dead. */
const NAVIGATION_SELECTOR = '[role="tab"], .split-view-view-header'
const NAVIGATION_BLOCKED_SELECTOR = '.split-view-view-header-actions'

function isNavigationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(NAVIGATION_BLOCKED_SELECTOR)) return false
  return target.closest(NAVIGATION_SELECTOR) !== null
}

/** Keys that only read or navigate. Enter/Space are absent on purpose —
 * they ACTIVATE buttons and toggles. */
const READONLY_KEYS = new Set([
  'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End', 'Escape'
])

function isReadOnlyKey(event: React.KeyboardEvent): boolean {
  if (READONLY_KEYS.has(event.key)) return true
  // Copy / select-all read the panel without mutating it.
  return (event.ctrlKey || event.metaKey) && ['a', 'c'].includes(event.key.toLowerCase())
}

/**
 * Renders `children` — the host's normal, fully-interactive entity panel,
 * UNMODIFIED — with every MUTATING interaction blocked but NAVIGATION kept
 * alive. This replaces the previous all-or-nothing `inert` approach, which
 * also froze the panel's own tab strip and collapsible section headers:
 * a read-only snapshot must still let the user open its tabs and fold /
 * unfold its sections to *inspect* it.
 *
 * Mechanics: capture-phase handlers on the wrapper stop the event before
 * any child (React or native, e.g. Monaco) sees it —
 * - `click` / `dblclick` / `auxclick` / `contextmenu` are blocked unless
 *   the target sits inside a navigation surface (`[role="tab"]`, a
 *   `SplitView` pane header — minus its header-actions cluster);
 * - `beforeinput` / `paste` / `cut` / `drop` / `dragstart` are always
 *   blocked (no navigation surface takes text input);
 * - `keydown` is allowed on navigation surfaces (tabs use Enter/Space/
 *   arrows) and for read-only keys elsewhere (arrows, Tab, PageUp/Down,
 *   Home/End, Escape, Ctrl/Cmd+A/C), blocked otherwise.
 * `mousedown`/`pointerdown` stay free so focus, text selection, custom
 * scrollbar drags and sash resizes keep working; activation is what's
 * gated, and that happens on `click`/`keydown`. A scoped
 * `pointer-events: none` on form controls (see the CSS) hard-blocks the
 * value-editing surfaces one level deeper as a defensive fallback.
 *
 * Not a substitute for a real `readOnly` prop where one already exists
 * (prefer that when available — it's more explicit); this exists for the
 * majority of entity panels that have no such prop today.
 */
export const ReadOnlyOverlay: React.FC<ReadOnlyOverlayProps> = ({ children, 'data-testid': dataTestId }) => {
  const blockUnlessNavigation = useCallback((event: React.SyntheticEvent) => {
    if (isNavigationTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const blockAlways = useCallback((event: React.SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const blockMutatingKeys = useCallback((event: React.KeyboardEvent) => {
    if (isNavigationTarget(event.target) || isReadOnlyKey(event)) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <div
      className="ecui-read-only-overlay"
      data-testid={dataTestId}
      onClickCapture={blockUnlessNavigation}
      onDoubleClickCapture={blockUnlessNavigation}
      onAuxClickCapture={blockUnlessNavigation}
      onContextMenuCapture={blockUnlessNavigation}
      onBeforeInputCapture={blockAlways}
      onPasteCapture={blockAlways}
      onCutCapture={blockAlways}
      onDropCapture={blockAlways}
      onDragStartCapture={blockAlways}
      onKeyDownCapture={blockMutatingKeys}
    >
      {children}
    </div>
  )
}
