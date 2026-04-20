import React, { useState, useRef, useEffect } from 'react'
import { StatusbarElementProps } from './types'
import { Tooltip } from '../Tooltip'
import { IconView } from '../IconView'
import { getContrastColor } from '../../utils/colorContrast'

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
  'data-testid': dataTestId
}) => {
  const testId = dataTestId
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const elementRef = useRef<HTMLDivElement>(null)
  const tooltipContentRef = useRef<HTMLDivElement | null>(null)

  const elementClasses = [
    'statusbar-item',
    warning && 'warning-kind',
    error && 'error-kind',
    disabled && 'statusbar-item--disabled',
    onClick && !disabled && 'clickable',
    className
  ].filter(Boolean).join(' ')

  const hasTooltip = children !== undefined && children !== null
  const clickMode = tooltipTrigger === 'click'

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
              {children}
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
    </>
  )
}

export default StatusbarElement
