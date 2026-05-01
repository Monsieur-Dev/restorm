import React, { useEffect, useRef } from 'react'
import Lottie, { type LottieRefCurrentProps } from 'lottie-react'
import animationData from './assets/star-lottie.json'

// Lottie endpoints — frame 0 = empty star, frame `op - 1` = filled
// star at the end of the burst. lottie-web's `op` is the
// out-point and is treated as the *exclusive* end of the visible
// range, so `goToAndStop(op, true)` lands on a past-end (often
// empty) frame. Use `op - 1` for the "filled" snap target.
const ANIM_FIRST_FRAME = (animationData as { ip?: number }).ip ?? 0
const ANIM_LAST_FRAME = ((animationData as { op?: number }).op ?? 80) - 1

interface StarAppearanceProps {
  /** Whether the star is currently in the "favorited" state. */
  active: boolean
  /** Whether the toggle is interactive. Mirrors Toggle's `disabled`. */
  disabled: boolean
  /** Click / activation handler. The Toggle itself flips state on click. */
  onActivate: () => void
  /** Keyboard handler — Toggle drives Space / Enter through here. */
  onKeyDown?: (event: React.KeyboardEvent) => void
  /** Optional aria-label. Falls back to the parent Toggle's children. */
  ariaLabel?: string
  /** Optional className appended to the action element. */
  className?: string
  /** Optional test id for the action element. */
  dataTestId?: string
  /** Whether the action element should participate in the tab order. */
  focusable: boolean
}

/**
 * Twitter-style favorite star renderer for the Toggle. Plays the
 * lottie forward (empty → filled with sparkle burst) when `active`
 * flips to true, reverse when it flips to false. The first paint
 * snaps to the matching frame so newly mounted rows for already-
 * favorited items don't replay the burst.
 */
export const StarAppearance: React.FC<StarAppearanceProps> = ({
  active,
  disabled,
  onActivate,
  onKeyDown,
  ariaLabel,
  className,
  dataTestId,
  focusable
}) => {
  const lottieRef = useRef<LottieRefCurrentProps>(null)
  const domReadyRef = useRef(false)
  const lastAppliedActive = useRef<boolean | null>(null)

  // The active-frame snap can only land once lottie-web has parsed
  // the JSON and built the SVG. Both `useEffect` and `onDOMLoaded`
  // race to be first; whichever wins triggers the snap, the other
  // becomes a no-op via the `lastAppliedActive` guard.
  const snapToActive = (next: boolean): void => {
    const ref = lottieRef.current
    if (!ref || !domReadyRef.current) return
    ref.goToAndStop(next ? ANIM_LAST_FRAME : ANIM_FIRST_FRAME, true)
    lastAppliedActive.current = next
  }

  useEffect(() => {
    const ref = lottieRef.current
    if (!ref) return
    // First time we successfully apply: snap. Subsequent active
    // transitions: animate forward / reverse — unless the user (or
    // an automated harness like Playwright) has reduced-motion on,
    // in which case we just snap to the target frame.
    if (lastAppliedActive.current === null) {
      snapToActive(active)
      return
    }
    if (lastAppliedActive.current === active) return
    const reducedMotion = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
    if (reducedMotion) {
      snapToActive(active)
      return
    }
    if (active) {
      ref.setDirection(1)
      ref.playSegments([ANIM_FIRST_FRAME, ANIM_LAST_FRAME], true)
    } else {
      ref.setDirection(-1)
      ref.playSegments([ANIM_LAST_FRAME, ANIM_FIRST_FRAME], true)
    }
    lastAppliedActive.current = active
  }, [active])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (disabled) return
    onActivate()
    // After a pointer-driven toggle, blur the action so the row's
    // hover-only visibility rules apply immediately (otherwise the
    // freshly-clicked star keeps focus and any `:focus` rule keeps
    // it visible until the user clicks elsewhere).
    event.currentTarget.blur()
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault()
      onActivate()
    }
    onKeyDown?.(event)
  }

  const buttonClassName = ['custom-toggle-star', className].filter(Boolean).join(' ')

  return (
    <div
      className={buttonClassName}
      role="checkbox"
      aria-checked={active}
      aria-disabled={disabled}
      tabIndex={focusable ? 0 : -1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
    >
      <Lottie
        lottieRef={lottieRef}
        animationData={animationData}
        autoplay={false}
        loop={false}
        onDOMLoaded={() => {
          domReadyRef.current = true
          if (lastAppliedActive.current === null) snapToActive(active)
        }}
      />
    </div>
  )
}
