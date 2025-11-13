import React, { useEffect, useRef, useState, useCallback } from 'react'
import './tooltip.css'

export interface TooltipProps {
  targetRef: React.RefObject<HTMLElement>
  content: React.ReactNode
  show: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  className?: string
}

const Tooltip: React.FC<TooltipProps> = ({ targetRef, content, show, onMouseEnter, onMouseLeave, className = '' }) => {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; beakLeftPercent: number }>({ top: -9999, left: -9999, beakLeftPercent: 50 })
  const [isPositioned, setIsPositioned] = useState(false)

  const updatePosition = useCallback(() => {
    if (!targetRef.current || !tooltipRef.current) return

    const targetRect = targetRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const gap = 3 // Reduced gap between tooltip and target
    const beakHeight = 5

    // Calculate target center (middle point between left and right edges of StatusbarElement)
    // This is the exact center of the button/element where the beak should point
    const targetCenterX = targetRect.left + (targetRect.width / 2)
    
    // Get tooltip width - if tooltip is at -9999, width might be 0, so we need to measure it differently
    const tooltipWidth = tooltipRect.width > 0 ? tooltipRect.width : tooltipRef.current.offsetWidth || tooltipRef.current.scrollWidth
    
    // Position tooltip centered on target (we'll adjust the beak position separately)
    let left = targetCenterX - (tooltipWidth / 2)
    
    // Position above the target element (statusbar is at bottom)
    // Descend by 5px as per user adjustment
    const tooltipHeight = tooltipRect.height > 0 ? tooltipRect.height : tooltipRef.current.offsetHeight || tooltipRef.current.scrollHeight
    let top = targetRect.top - tooltipHeight - gap - beakHeight + 5

    // Adjust if tooltip goes off screen horizontally
    const minLeft = gap
    const maxLeft = viewportWidth - tooltipWidth - gap
    
    // Check if tooltip would go off screen
    if (left < minLeft) {
      left = minLeft
    } else if (left > maxLeft) {
      left = maxLeft
    }

    // If tooltip would go above viewport, show below instead
    if (top < gap) {
      top = targetRect.bottom + gap
    }

    // Calculate beak position as percentage
    // beakLeftPercent = ((targetCenterX - tooltipLeft) / tooltipWidth) * 100
    // This ensures the beak points to the center of the target button
    const beakLeftPercent = ((targetCenterX - left) / tooltipWidth) * 100

    setPosition({ top, left, beakLeftPercent })
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
  }, [targetRef])

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

