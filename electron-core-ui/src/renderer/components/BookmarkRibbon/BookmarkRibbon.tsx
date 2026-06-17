import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { getContrastColor } from '../../utils/colorContrast'
import { getColorFromString } from '../../utils/colorFromString'
import { Tooltip } from '../Tooltip'
import { ColorPicker } from '../ColorPicker'
import { Button } from '../Button'
import { InputBox } from '../InputBox'

import './bookmarkRibbon.css'

export interface BookmarkRibbonProps {
  label: string
  /** Explicit colour override. Falls back to a deterministic colour
   * derived from the label when omitted. */
  color?: string
  /** When false, the ribbon is a pure display element: clicking does
   * nothing, no editor tooltip is ever mounted, and `aria-expanded`
   * is dropped. Hover still unfurls the label so the rotated text
   * stays discoverable. Defaults to true. */
  editable?: boolean
  /** Rename handler — called on tooltip-editor commit. */
  onRename?: (next: string) => void
  /** Colour change handler — called from the tooltip colour picker.
   * When omitted, the picker is hidden from the editor tooltip. */
  onColorChange?: (hex: string) => void
  /** Remove handler — optional; when omitted the trash button is hidden. */
  onRemove?: () => void
  /** Extra class forwarded to the ribbon root. */
  className?: string
  'data-testid'?: string
}

/** Animation phase of the unfurl/refurl choreography.
 *
 * `idle` → ribbon collapsed, label hidden.
 * `opening` → entry in flight (height grow, then label fade-in).
 * `open` → fully extended, label visible.
 * `closing` → exit in flight (3 s grace, label fade, height collapse).
 */
type AnimationState = 'idle' | 'opening' | 'open' | 'closing'

interface AnimState {
  phase: AnimationState
  /** Set when the user mouses out (or focus moves away) before the
   * entry animation finishes. The reducer defers the close until the
   * entry's `transitionend` fires, so a short hover still completes
   * the entry choreography before any exit can start. */
  leaveRequested: boolean
}

type AnimAction =
  | { type: 'ENTER' }
  | { type: 'LEAVE' }
  | { type: 'ENTRY_DONE' }
  | { type: 'EXIT_DONE' }

const initialAnimState: AnimState = { phase: 'idle', leaveRequested: false }

/** Self-heal budgets (ms). The choreography is driven by CSS
 * `transitionend` events, but those are not guaranteed to fire — a
 * coalesced/cancelled transition, a backgrounded tab, or a re-render
 * that interrupts the transition all swallow the event, and the state
 * machine would then deadlock in `opening` / `closing` and the ribbon
 * would stay visually extended forever (the reported "stuck open"
 * bug). Each phase therefore arms a watchdog that dispatches the same
 * terminal action the missing `transitionend` would have, generously
 * past the CSS budget so it never pre-empts the real animation.
 *
 * Entry CSS budget: 0.4 s height + 0.3 s opacity = 0.7 s.
 * Exit CSS budget: 3.3 s grace + 0.4 s height = 3.7 s. */
const ENTRY_WATCHDOG_MS = 1500
const EXIT_WATCHDOG_MS = 5000

function animReducer(state: AnimState, action: AnimAction): AnimState {
  switch (action.type) {
    case 'ENTER':
      // Any "wants-open" signal restarts the entry from idle/closing,
      // and on opening/open just clears a previously-queued leave.
      if (state.phase === 'idle' || state.phase === 'closing') {
        return { phase: 'opening', leaveRequested: false }
      }
      return state.leaveRequested ? { ...state, leaveRequested: false } : state
    case 'LEAVE':
      // From `open` we can start the exit immediately. From `opening`
      // we defer — the exit must not interrupt the entry mid-flight
      // (a CSS-only `:hover` switch would freeze the ribbon at its
      // half-extended interpolated height). From `idle` / `closing`
      // there's nothing to do.
      if (state.phase === 'open') return { phase: 'closing', leaveRequested: false }
      if (state.phase === 'opening') return { ...state, leaveRequested: true }
      return state
    case 'ENTRY_DONE':
      // Entry choreography finished. Honor a deferred leave by going
      // straight to closing; otherwise settle in `open`.
      if (state.phase !== 'opening') return state
      if (state.leaveRequested) return { phase: 'closing', leaveRequested: false }
      return { phase: 'open', leaveRequested: false }
    case 'EXIT_DONE':
      if (state.phase !== 'closing') return state
      return { phase: 'idle', leaveRequested: false }
  }
}

/**
 * Bookmark-style ribbon. Idle: a thin vertical colour strip stuck to
 * the top edge of its positioned ancestor. Hover/focus: the strip
 * extends downward and the label rotates 90° clockwise, reading
 * top-to-bottom. Click: opens a small editor tooltip (rename /
 * recolour / remove).
 *
 * Layout is position-agnostic — use `<BookmarkRibbonStack>` to anchor
 * a row of ribbons to the top-right of a pane.
 *
 * The unfurl/refurl choreography is JS-gated (state machine + class
 * toggling) rather than pure-CSS `:hover`. This guarantees the entry
 * animation always plays through to completion before any exit can
 * start — leaving the ribbon mid-entry no longer freezes it in a
 * half-extended intermediate state.
 */
export const BookmarkRibbon: React.FC<BookmarkRibbonProps> = ({
  label,
  color,
  editable = true,
  onRename,
  onColorChange,
  onRemove,
  className,
  'data-testid': dataTestId
}) => {
  const [editorOpen, setEditorOpen] = useState(false)
  const [draftLabel, setDraftLabel] = useState(label)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [animState, dispatch] = useReducer(animReducer, initialAnimState)
  const rootRef = useRef<HTMLButtonElement | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)

  // Drive the animation reducer from the union of "wants-open" signals
  // (mouse, keyboard focus, editor-tooltip locked open). When any is
  // true we want the ribbon extended; when none remain we want it
  // collapsed. Doing this in an effect rather than at the event
  // callsites keeps the three sources composable — e.g. closing the
  // editor tooltip while the cursor is still inside the ribbon must
  // NOT trigger the exit.
  const wantsOpen = hovered || focused || editorOpen
  useEffect(() => {
    dispatch({ type: wantsOpen ? 'ENTER' : 'LEAVE' })
  }, [wantsOpen])

  // Self-heal watchdog. `handleTransitionEnd` is the normal driver out
  // of the `opening` / `closing` phases, but a dropped `transitionend`
  // (coalesced / cancelled transition, hidden tab, mid-transition
  // re-render) would otherwise leave the machine wedged in a transient
  // phase and the ribbon stuck extended. Arm a timer per transient
  // phase that fires the same terminal action the missing event would
  // have. Re-armed on every phase change; cleared when we reach a
  // settled phase (`idle` / `open`).
  useEffect(() => {
    if (animState.phase === 'opening') {
      const t = setTimeout(() => { dispatch({ type: 'ENTRY_DONE' }) }, ENTRY_WATCHDOG_MS)
      return () => { clearTimeout(t) }
    }
    if (animState.phase === 'closing') {
      const t = setTimeout(() => { dispatch({ type: 'EXIT_DONE' }) }, EXIT_WATCHDOG_MS)
      return () => { clearTimeout(t) }
    }
    return undefined
  }, [animState.phase])

  // Hard guard against a persistent stuck-open state: the ribbon must
  // never stay visually extended (`opening` / `open` / `closing`) while
  // there is no "wants-open" signal. The reducer + watchdogs already
  // route every transient phase toward collapse, but `open` with no
  // pending LEAVE is the one settled phase that could otherwise linger
  // if its triggering LEAVE was somehow never dispatched. Force the
  // exit here so collapse is guaranteed whenever the pointer/focus has
  // left and the editor is closed.
  useEffect(() => {
    if (!wantsOpen && animState.phase === 'open') {
      dispatch({ type: 'LEAVE' })
    }
  }, [wantsOpen, animState.phase])

  // Close the editor tooltip when the user clicks outside of the
  // ribbon button + the tooltip content. `mousedown` runs before
  // `click`, so any intent to interact with the current tooltip is
  // already handled by the editor's own `stopPropagation` before we
  // reach here.
  useEffect(() => {
    if (!editorOpen) return undefined
    const handler = (ev: MouseEvent): void => {
      const target = ev.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target)) return
      if (editorRef.current?.contains(target)) return
      setEditorOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => { document.removeEventListener('mousedown', handler) }
  }, [editorOpen])

  const effectiveColor = color ?? getColorFromString(label)
  const textColor = getContrastColor(effectiveColor)

  const handleToggle = useCallback(() => {
    if (!editable) return
    setEditorOpen((prev) => {
      if (!prev) setDraftLabel(label)
      return !prev
    })
  }, [editable, label])

  const handleCommitRename = useCallback(() => {
    const trimmed = draftLabel.trim()
    if (trimmed && trimmed !== label && onRename) {
      onRename(trimmed)
    }
  }, [draftLabel, label, onRename])

  const handleRemove = useCallback(() => {
    setEditorOpen(false)
    onRemove?.()
  }, [onRemove])

  // Listen for the choreography's terminal transitions on the root.
  // - Entry: the LABEL's opacity transition is the last one to finish
  //   (height 0 → 0.4 s, then opacity 0.4 → 0.7 s). Bubbles up via
  //   `transitionend`.
  // - Exit: the ROOT's height transition is the last one (label fade
  //   0 → 3.3 s, height 3.3 → 3.7 s).
  const handleTransitionEnd = useCallback((ev: React.TransitionEvent<HTMLButtonElement>): void => {
    if (animState.phase === 'opening' && ev.propertyName === 'opacity') {
      dispatch({ type: 'ENTRY_DONE' })
      return
    }
    if (animState.phase === 'closing' && ev.propertyName === 'height' && ev.target === ev.currentTarget) {
      dispatch({ type: 'EXIT_DONE' })
    }
  }, [animState.phase])

  const phaseClass = animState.phase === 'idle' ? '' : `ecui-bookmark-ribbon--${animState.phase}`

  const rootClasses = [
    'ecui-bookmark-ribbon',
    phaseClass,
    editable ? '' : 'ecui-bookmark-ribbon--readonly',
    className ?? ''
  ].filter(Boolean).join(' ')

  return (
    <>
      <button
        ref={rootRef}
        type="button"
        className={rootClasses}
        style={{ '--bookmark-color': effectiveColor, '--bookmark-text-color': textColor } as React.CSSProperties}
        aria-label={`Bookmark: ${label}`}
        {...(editable ? { 'aria-expanded': editorOpen } : {})}
        {...(editable ? { onClick: handleToggle } : {})}
        onMouseEnter={() => { setHovered(true) }}
        onMouseLeave={() => { setHovered(false) }}
        onFocus={() => { setFocused(true) }}
        onBlur={() => { setFocused(false) }}
        onTransitionEnd={handleTransitionEnd}
        {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
      >
        <span className="ecui-bookmark-ribbon-label">{label}</span>
      </button>
      {editable ? (
      <Tooltip
        targetRef={rootRef as React.RefObject<HTMLElement | null>}
        show={editorOpen}
        placement="below"
        className="ecui-bookmark-ribbon-tooltip"
        {...(dataTestId ? { 'data-testid': `${dataTestId}-tooltip` } : {})}
        content={
          <div
            ref={editorRef}
            className="ecui-bookmark-ribbon-editor"
            onMouseDown={(e) => { e.stopPropagation() }}
          >
            <InputBox
              options={{ placeholder: 'Bookmark name' }}
              value={draftLabel}
              // Commit reads `draftLabel` synchronously on Enter / blur, so the
              // draft must track every keystroke — a debounced onChange would
              // leave it stale at commit time. Discrete edit, no per-keystroke
              // persistence, so immediate emit costs nothing here.
              changeDebounceMs={0}
              onChange={(next) => { setDraftLabel(next) }}
              onBlur={handleCommitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleCommitRename()
                  setEditorOpen(false)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditorOpen(false)
                }
              }}
              {...(dataTestId ? { 'data-testid': `${dataTestId}-rename-input` } : {})}
            />
            {onColorChange ? (
              <ColorPicker
                value={effectiveColor}
                onChange={onColorChange}
                disableAlpha
                {...(dataTestId ? { 'data-testid': `${dataTestId}-color-picker` } : {})}
              />
            ) : null}
            {onRemove ? (
              <Button
                secondary
                fullWidth
                icon="trash"
                onClick={handleRemove}
                options={{ ariaLabel: 'Remove bookmark', title: 'Remove bookmark' }}
                {...(dataTestId ? { 'data-testid': `${dataTestId}-remove` } : {})}
              />
            ) : null}
          </div>
        }
      />
      ) : null}
    </>
  )
}

export default BookmarkRibbon
