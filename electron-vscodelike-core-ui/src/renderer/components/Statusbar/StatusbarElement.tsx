import React, { useState, useRef, useEffect } from 'react'
import { StatusbarElementProps } from './types'
import { Tooltip } from '../Tooltip'

const StatusbarElement: React.FC<StatusbarElementProps> = ({
  title,
  warning = false,
  error = false,
  onClick,
  className = '',
  id,
  children
}) => {
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const elementRef = useRef<HTMLDivElement>(null)

  const elementClasses = [
    'statusbar-item',
    warning && 'warning-kind',
    error && 'error-kind',
    onClick && 'clickable',
    className
  ].filter(Boolean).join(' ')

  const hasTooltip = children !== undefined && children !== null

  const handleMouseEnter = (): void => {
    if (hasTooltip) {
      // Clear any pending hide timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
      // Delay showing tooltip (similar to VSCode)
      const timeout = setTimeout(() => {
        setShowTooltip(true)
      }, 300) // 300ms delay like VSCode
      tooltipTimeoutRef.current = timeout
    }
  }

  const handleMouseLeave = (): void => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    // Delay hiding tooltip to allow mouse to enter tooltip
    const timeout = setTimeout(() => {
      setShowTooltip(false)
    }, 100) // Small delay to allow mouse to move to tooltip
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

  return (
    <>
      <div
        ref={elementRef}
        id={id}
        className={elementClasses}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick(e as unknown as React.MouseEvent<HTMLDivElement>)
          }
        } : undefined}
      >
        {title}
      </div>
      {hasTooltip && (
        <Tooltip
          targetRef={elementRef}
          content={children}
          show={showTooltip}
          onMouseEnter={() => {
            // Keep tooltip visible when mouse enters it
            if (hideTimeoutRef.current) {
              clearTimeout(hideTimeoutRef.current)
              hideTimeoutRef.current = null
            }
            if (tooltipTimeoutRef.current) {
              clearTimeout(tooltipTimeoutRef.current)
              tooltipTimeoutRef.current = null
            }
            setShowTooltip(true)
          }}
          onMouseLeave={() => {
            // Hide tooltip when mouse leaves it
            const timeout = setTimeout(() => {
              setShowTooltip(false)
            }, 100)
            hideTimeoutRef.current = timeout
          }}
        />
      )}
    </>
  )
}

export default StatusbarElement

