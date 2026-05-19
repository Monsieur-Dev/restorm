import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { StatusbarElementProps } from './types'
import { Tooltip } from '../Tooltip'
import { IconView } from '../IconView'
import { getContrastColor } from '../../utils/colorContrast'
import { StatusbarTooltipContext } from './StatusbarTooltipContext'

interface PulseEntry {
  id: number
}

const StatusbarElement: React.FC<StatusbarElementProps> = ({
  title,
  icon,
  backgroundColor,
  warning = false,
  error = false,
  disabled = false,
  overlay,
  onClick,
  className = '',
  id,
  children,
  tooltipTrigger = 'hover',
  tooltipPlacement = 'auto',
  pulseSignal,
  pulseColor,
  'data-testid': dataTestId
}) => {
  const testId = dataTestId
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const elementRef = useRef<HTMLDivElement>(null)
  const tooltipContentRef = useRef<HTMLDivElement | null>(null)

  const hasTooltip = children !== undefined && children !== null
  const clickMode = tooltipTrigger === 'click'

  // A cell is "clickable" — and therefore renders the pointer cursor —
  // either because it has a real `onClick`, or because it owns a
  // click-triggered popover (`children` + `tooltipTrigger="click"`).
  // The latter mirrors how the env / auth selectors behave: no
  // `onClick`, but a click on the cell opens their popover.
  const isInteractive = !disabled && (Boolean(onClick) || (hasTooltip && clickMode))

  // Activity ripples (driven by `pulseSignal` increments). Each pulse
  // pushes one entry; entries self-destruct on `onAnimationEnd`. Only
  // works when the cell has a codicon (the ripple anchors on it).
  const [pulses, setPulses] = useState<PulseEntry[]>([])
  const [pulseAnchorRect, setPulseAnchorRect] = useState<DOMRect | null>(null)
  const [pulseIconColor, setPulseIconColor] = useState<string | null>(null)
  const lastPulseSignalRef = useRef<number | undefined>(pulseSignal)
  const nextPulseIdRef = useRef(0)
  const duplicateIconRef = useRef<HTMLElement | null>(null)
  const pulseEnabled = icon?.type === 'codicon'

  useEffect(() => {
    if (!pulseEnabled) return
    if (pulseSignal === undefined) return
    if (lastPulseSignalRef.current === pulseSignal) return
    lastPulseSignalRef.current = pulseSignal
    const id = nextPulseIdRef.current++
    setPulses((prev) => [...prev, { id }])
  }, [pulseSignal, pulseEnabled])

  // Snapshot the original codicon's bbox + computed color when at
  // least one pulse is active. The portal escapes the statusbar's
  // cascade so we can't inherit the color reliably; reading it here
  // and pinning it inline (with `important` priority — see effect
  // below) makes the duplicate match every theme.
  useEffect(() => {
    if (!pulseEnabled || pulses.length === 0) return
    const updateRect = (): void => {
      const cell = elementRef.current
      const codicon = cell?.querySelector('.codicon') as HTMLElement | null
      if (!codicon) return
      setPulseAnchorRect(codicon.getBoundingClientRect())
      setPulseIconColor(getComputedStyle(codicon).color)
    }
    updateRect()
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)
    return () => {
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [pulseEnabled, pulses.length])

  // The codicon library (or some theme stylesheet) pins codicon color
  // with `!important`, so a plain `style={{ color }}` gets overridden.
  // `setProperty(..., 'important')` punches through.
  useEffect(() => {
    const el = duplicateIconRef.current
    if (!el || !pulseIconColor) return
    el.style.setProperty('color', pulseIconColor, 'important')
  }, [pulseIconColor, pulses.length])

  const removePulse = useCallback((id: number) => {
    setPulses((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const elementClasses = [
    'statusbar-item',
    warning && 'warning-kind',
    error && 'error-kind',
    disabled && 'statusbar-item--disabled',
    isInteractive && 'clickable',
    pulseEnabled && pulses.length > 0 && 'statusbar-item--pulsing',
    className
  ].filter(Boolean).join(' ')

  const handleMouseEnter = (): void => {
    if (!hasTooltip || clickMode) return
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    // Delay showing tooltip
    const timeout = setTimeout(() => {
      setShowTooltip(true)
    }, 300)
    tooltipTimeoutRef.current = timeout
  }

  const handleMouseLeave = (): void => {
    if (!hasTooltip || clickMode) return
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    // Delay hiding tooltip to allow mouse to enter tooltip
    const timeout = setTimeout(() => {
      setShowTooltip(false)
    }, 100)
    hideTimeoutRef.current = timeout
  }

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current)
      }
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  // Click-mode: close on outside click / Escape. Clicks inside the
  // tooltip content (e.g. a popover item) are allowed without closing;
  // clicks on the trigger itself are already handled by `onClick`'s
  // toggle below.
  useEffect(() => {
    if (!hasTooltip || !clickMode || !showTooltip) return
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (elementRef.current?.contains(target)) return
      if (tooltipContentRef.current?.contains(target)) return
      setShowTooltip(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowTooltip(false)
    }
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [hasTooltip, clickMode, showTooltip])

  const handleCellClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (hasTooltip && clickMode) {
      setShowTooltip((prev) => !prev)
    }
    onClick?.(event)
  }

  // Imperative close handler exposed to click-mode popover content via
  // `StatusbarTooltipContext`. Lets the inner content dismiss the
  // popover itself after a user action — e.g. an env picker closes on
  // env-select but stays open while the user toggles "Apply to all".
  const closeTooltip = useCallback((): void => { setShowTooltip(false) }, [])
  const tooltipContextValue = useMemo(() => ({ closeTooltip }), [closeTooltip])

  const hasIcon = icon !== undefined && icon !== null && icon.type !== 'none'
  const hasTitle = title !== undefined && title !== null && title !== ''

  const inlineStyle: React.CSSProperties | undefined = backgroundColor
    ? { backgroundColor, color: getContrastColor(backgroundColor), borderColor: backgroundColor }
    : undefined

  return (
    <>
      <div
        ref={elementRef}
        id={id}
        className={elementClasses}
        onClick={disabled ? undefined : handleCellClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role={(onClick || (hasTooltip && clickMode)) ? 'button' : undefined}
        aria-expanded={hasTooltip && clickMode ? showTooltip : undefined}
        tabIndex={(onClick || (hasTooltip && clickMode)) ? 0 : undefined}
        onKeyDown={(onClick || (hasTooltip && clickMode)) ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCellClick(e as unknown as React.MouseEvent<HTMLDivElement>)
          }
        } : undefined}
        {...(inlineStyle ? { style: inlineStyle } : {})}
        {...(testId && {
          'data-testid': testId,
          'data-warning': warning ? 'true' : 'false',
          'data-error': error ? 'true' : 'false',
          'data-clickable': onClick ? 'true' : 'false',
          'data-has-tooltip': hasTooltip ? 'true' : 'false',
          'data-tooltip-visible': showTooltip ? 'true' : 'false'
        })}
      >
        {hasIcon && (
          <IconView
            icon={icon}
            size={16}
            className="statusbar-item-icon"
            {...(testId ? { 'data-testid': `${testId}-icon` } : {})}
          />
        )}
        {hasTitle && (
          <span
            className="statusbar-item-label"
            {...(testId && { 'data-testid': `${testId}-label` })}
          >
            {title}
          </span>
        )}
        {overlay}
      </div>
      {hasTooltip && (
        <Tooltip
          targetRef={elementRef}
          placement={tooltipPlacement}
          content={(
            <div ref={tooltipContentRef}>
              <StatusbarTooltipContext.Provider value={tooltipContextValue}>
                {children}
              </StatusbarTooltipContext.Provider>
            </div>
          )}
          show={showTooltip}
          {...(testId && { 'data-testid': `${testId}-tooltip` })}
          {...(clickMode
            ? {}
            : {
              onMouseEnter: () => {
                if (hideTimeoutRef.current) {
                  clearTimeout(hideTimeoutRef.current)
                  hideTimeoutRef.current = null
                }
                if (tooltipTimeoutRef.current) {
                  clearTimeout(tooltipTimeoutRef.current)
                  tooltipTimeoutRef.current = null
                }
                setShowTooltip(true)
              },
              onMouseLeave: () => {
                const timeout = setTimeout(() => {
                  setShowTooltip(false)
                }, 100)
                hideTimeoutRef.current = timeout
              }
            })}
        />
      )}
      {pulseEnabled && pulses.length > 0 && pulseAnchorRect !== null && createPortal(
        <div
          className="statusbar-pulse-portal"
          {...(testId && { 'data-testid': `${testId}-pulse-portal` })}
          style={{
            top: pulseAnchorRect.top,
            left: pulseAnchorRect.left,
            width: pulseAnchorRect.width,
            height: pulseAnchorRect.height
          }}
        >
          {pulses.map((p) => (
            <span
              key={p.id}
              className="statusbar-pulse-wave"
              {...(testId && { 'data-testid': `${testId}-pulse-wave` })}
              style={{
                width: Math.min(pulseAnchorRect.width, pulseAnchorRect.height),
                height: Math.min(pulseAnchorRect.width, pulseAnchorRect.height),
                ...(pulseColor ? { backgroundColor: pulseColor } : {})
              }}
              onAnimationEnd={() => { removePulse(p.id) }}
            />
          ))}
          {/* Duplicate codicon painted on top of the wave so the icon
           * stays anchored. Color is pinned via setProperty in the
           * effect above (a `!important` rule in the codicon library
           * would otherwise win over a plain inline style). */}
          {icon.type === 'codicon' && (
            <i
              ref={duplicateIconRef}
              className={`codicon codicon-${icon.value}`}
              aria-hidden="true"
            />
          )}
        </div>,
        document.body
      )}
    </>
  )
}

export default StatusbarElement
