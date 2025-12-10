import React, { useEffect, useRef, useState, useCallback } from 'react'
import './tooltip.css'

export interface TooltipProps {
  targetRef: React.RefObject<HTMLElement>
  content: React.ReactNode
  show: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  className?: string
  /**
   * Vertical placement strategy:
   * - 'auto' (default): prefer above the target, but fall back below if there is not enough space.
   * - 'above': always position above the target (clamped to viewport).
   * - 'below': prefer below the target, falling back above only when there is no space below.
   */
  placement?: 'auto' | 'above' | 'below'
}

const Tooltip: React.FC<TooltipProps> = ({
  targetRef,
  content,
  show,
  onMouseEnter,
  onMouseLeave,
  className = '',
  placement = 'auto'
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; beakLeftPercent: number }>({ top: -9999, left: -9999, beakLeftPercent: 50 })
  const [isPositioned, setIsPositioned] = useState(false)
  const [resolvedPlacement, setResolvedPlacement] = useState<'above' | 'below'>('above')

  const updatePosition = useCallback(() => {
    if (!targetRef.current || !tooltipRef.current) return

    const targetRect = targetRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const gap = 3 // Reduced gap between tooltip and target
    const beakHeight = 5

    // Calculate target center (middle point between left and right edges of StatusbarElement)
    // This is the exact center of the button/element where the beak should point
    const targetCenterX = targetRect.left + (targetRect.width / 2)
    
    // Get tooltip width - if tooltip is at -9999, width might be 0, so we need to measure it differently
    const tooltipWidth = tooltipRect.width > 0 ? tooltipRect.width : tooltipRef.current.offsetWidth || tooltipRef.current.scrollWidth
    
    // Position tooltip centered on target (we'll adjust the beak position separately)
    let left = targetCenterX - (tooltipWidth / 2)
    
    // Measure tooltip height (may be 0 on first pass, so fall back to DOM metrics)
    const tooltipHeight = tooltipRect.height > 0 ? tooltipRect.height : tooltipRef.current.offsetHeight || tooltipRef.current.scrollHeight
    let top: number
    let nextPlacement: 'above' | 'below'

    if (placement === 'above') {
      // Explicitly above the target (used for statusbar-style tooltips)
      top = targetRect.top - tooltipHeight - gap - beakHeight + 5
      if (top < gap) {
        top = gap
      }
      nextPlacement = 'above'
    } else if (placement === 'below') {
      // Prefer below the target; if there is no room, fall back above
      top = targetRect.bottom + gap + beakHeight
      if (top + tooltipHeight + gap > viewportHeight) {
        const aboveTop = targetRect.top - tooltipHeight - gap - beakHeight + 5
        if (aboveTop >= gap) {
          top = aboveTop
          nextPlacement = 'above'
        } else {
          top = Math.max(gap, viewportHeight - tooltipHeight - gap)
          nextPlacement = 'below'
        }
      } else {
        nextPlacement = 'below'
      }
    } else {
      // 'auto': prefer above (original behavior), but fall back below if not enough space
      const aboveTop = targetRect.top - tooltipHeight - gap - beakHeight + 5
      if (aboveTop >= gap) {
        top = aboveTop
        nextPlacement = 'above'
      } else {
        top = targetRect.bottom + gap + beakHeight
        // If still out of bounds at the bottom, clamp inside viewport
        if (top + tooltipHeight + gap > viewportHeight) {
          top = Math.max(gap, viewportHeight - tooltipHeight - gap)
        }
        nextPlacement = 'below'
      }
    }

    // Adjust if tooltip goes off screen horizontally
    const minLeft = gap
    const maxLeft = viewportWidth - tooltipWidth - gap
    
    // Check if tooltip would go off screen
    if (left < minLeft) {
      left = minLeft
    } else if (left > maxLeft) {
      left = maxLeft
    }

    // Calculate beak position as percentage
    // beakLeftPercent = ((targetCenterX - tooltipLeft) / tooltipWidth) * 100
    // This ensures the beak points to the center of the target button
    const beakLeftPercent = ((targetCenterX - left) / tooltipWidth) * 100

    setPosition({ top, left, beakLeftPercent })
    setResolvedPlacement(nextPlacement)
    setIsPositioned(true)
    
    // Recalculate after positioning to ensure accurate beak position
    // This handles cases where tooltip width changes after initial render
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (tooltipRef.current && targetRef.current) {
          const finalTooltipRect = tooltipRef.current.getBoundingClientRect()
          const finalTargetRect = targetRef.current.getBoundingClientRect()
          const finalTargetCenterX = finalTargetRect.left + (finalTargetRect.width / 2)
          const finalTooltipLeft = finalTooltipRect.left
          const finalTooltipWidth = finalTooltipRect.width
          
          // Recalculate beak position
          const finalBeakLeftPercent = ((finalTargetCenterX - finalTooltipLeft) / finalTooltipWidth) * 100
          
          setPosition(prev => ({
            ...prev,
            beakLeftPercent: finalBeakLeftPercent
          }))
        }
      })
    })
  }, [targetRef, placement])

  useEffect(() => {
    if (show) {
      // Reset positioning state
      setIsPositioned(false)
      setPosition({ top: -9999, left: -9999, beakLeftPercent: 50 })
      // Wait for next frame to ensure tooltip is rendered and has dimensions
      requestAnimationFrame(() => {
        // Double RAF to ensure layout is complete
        requestAnimationFrame(() => {
          updatePosition()
          // Recalculate multiple times to ensure final width is set
          setTimeout(() => {
            updatePosition()
            setTimeout(() => {
              updatePosition()
            }, 10)
          }, 10)
        })
      })
    } else {
      setIsPositioned(false)
      setPosition({ top: -9999, left: -9999, beakLeftPercent: 50 })
    }
  }, [show, updatePosition])

  useEffect(() => {
    if (!show) {
      return
    }
    
    const handleResize = (): void => {
      updatePosition()
    }
    const handleScroll = (): void => {
      updatePosition()
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [show, updatePosition])

  if (!show || !content) {
    return null
  }

  const tooltipClasses = ['tooltip', className].filter(Boolean).join(' ')

  return (
    <div
      ref={tooltipRef}
      className={tooltipClasses}
      data-placement={resolvedPlacement}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 10000,
        opacity: isPositioned ? 1 : 0,
        transition: isPositioned ? 'opacity 100ms linear' : 'none',
        '--beak-left-percent': `${position.beakLeftPercent}%`
      } as React.CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="tooltip-content">
        {content}
      </div>
    </div>
  )
}

export default Tooltip

