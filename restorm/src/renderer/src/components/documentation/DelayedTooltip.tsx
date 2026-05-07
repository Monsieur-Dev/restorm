import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from 'electron-core-ui/renderer'

export interface DelayedTooltipProps {
  /** Content rendered inside the tooltip. The wrapped children fire
   * hover detection. */
  content: React.ReactNode
  /** Hover delay in ms before the tooltip appears. The user-facing
   * convention in this app is 1000 ms — long enough that an
   * incidental mouse pass doesn't surface tooltips. */
  delayMs?: number
  children: React.ReactNode
  /** HTML element used for the wrapper that captures hover. Defaults
   * to `'span'`; use `'li'` / `'div'` when tooltip-wrapping a row
   * inside a list / flex container that styles by element. */
  as?: 'span' | 'div' | 'li'
  /** Optional CSS class on the wrapper. */
  className?: string
  /** Optional test id stamped on the tooltip itself. */
  testId?: string
}

/**
 * Hover-with-delay wrapper around ECUI's `Tooltip`. Owns its own
 * wrapper element (default `<span>`, switchable via `as`) so the
 * ref attaches via JSX rather than `cloneElement` — the React 19
 * `react-hooks/refs` rule rejects ref-via-cloneElement.
 */
export const DelayedTooltip: React.FC<DelayedTooltipProps> = ({
  content,
  delayMs = 1000,
  children,
  as = 'span',
  className,
  testId
}) => {
  const targetRef = useRef<HTMLElement | null>(null)
  const [show, setShow] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const handleEnter = useCallback(() => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      setShow(true)
    }, delayMs)
  }, [clearTimer, delayMs])

  const handleLeave = useCallback(() => {
    clearTimer()
    setShow(false)
  }, [clearTimer])

  useEffect(() => {
    return (): void => {
      clearTimer()
    }
  }, [clearTimer])

  const setRef = useCallback((node: HTMLElement | null): void => {
    targetRef.current = node
  }, [])

  const wrapper = as === 'li' ? (
    <li ref={setRef as React.Ref<HTMLLIElement>} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className={className}>
      {children}
    </li>
  ) : as === 'div' ? (
    <div ref={setRef as React.Ref<HTMLDivElement>} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className={className}>
      {children}
    </div>
  ) : (
    <span ref={setRef as React.Ref<HTMLSpanElement>} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className={className}>
      {children}
    </span>
  )

  return (
    <>
      {wrapper}
      <Tooltip
        targetRef={targetRef}
        content={content}
        show={show}
        {...(testId !== undefined ? { 'data-testid': testId } : {})}
      />
    </>
  )
}
