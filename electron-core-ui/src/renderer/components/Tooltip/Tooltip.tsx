import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayPresence } from '../../hooks/useOverlayPresence'
import './tooltip.css'

export interface TooltipProps {
  targetRef: React.RefObject<HTMLElement | null>
  content: React.ReactNode
  show: boolean
  /** Optional test id applied to the tooltip root element. */
  'data-testid'?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  className?: string
  /**
   * Vertical placement strategy:
   * - 'auto' (default): prefer above the target, but fall back below if there is not enough space.
   * - 'above': always position above the target (clamped to viewport).
   * - 'below': prefer below the target, falling back above only when there is no space below.
   */
  placement?: 'auto' | 'above' | 'below'
  /**
   * Horizontal side positioning:
   * - 'auto' (default): use standard above/below placement
   * - 'right': position tooltip to the right of the target, beak on the left
   * - 'left': position tooltip to the left of the target, beak on the right
   */
  side?: 'auto' | 'right' | 'left'
  /**
   * Fixed top position in pixels. When set, overrides vertical placement calculation.
   */
  fixedTop?: number
  /**
   * Key to force repositioning when target changes. Pass a unique value (e.g., item ID)
   * to trigger position recalculation when hovering different elements.
   */
  repositionKey?: string | number | null
}

const Tooltip: React.FC<TooltipProps> = ({
  targetRef,
  content,
  show,
  'data-testid': dataTestId,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  className = '',
  placement = 'auto',
  side = 'auto',
  fixedTop,
  repositionKey
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null)
  // Tell the MiniBrowser (or any listener) that an overlay with this
  // tooltip's footprint is currently mounted while `show` is true.
  // The hook reads the rect lazily from `tooltipRef`, so a tooltip
  // that re-positions itself after first paint is automatically up
  // to date.
  useOverlayPresence(tooltipRef, show)
  const [position, setPosition] = useState<{ top: number; left: number; beakLeftPercent: number; beakTopPercent: number | undefined }>({ top: -9999, left: -9999, beakLeftPercent: 50, beakTopPercent: undefined })
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
    const beakWidth = 6
    
    // Get tooltip dimensions - if tooltip is at -9999, dimensions might be 0
    const tooltipWidth = tooltipRect.width > 0 ? tooltipRect.width : tooltipRef.current.offsetWidth || tooltipRef.current.scrollWidth
    const tooltipHeight = tooltipRect.height > 0 ? tooltipRect.height : tooltipRef.current.offsetHeight || tooltipRef.current.scrollHeight

    let top: number
    let left: number
    let beakLeftPercent = 50
    let beakTopPercent: number | undefined
    let nextPlacement: 'above' | 'below' = 'above'

    // Side positioning (tooltip to the right of target)
    if (side === 'right') {
      // Position tooltip to the right of the target
      left = targetRect.right + gap + beakWidth
      const targetCenterY = targetRect.top + targetRect.height / 2

      // `fixedTop` is the caller's preferred top — useful when several
      // adjacent hover targets share a panel and a stable tooltip top
      // avoids jumpy chrome. But the beak has to land on the hovered
      // row, so we treat `fixedTop` as a soft hint and pull the
      // tooltip just far enough off it to keep the target's centre
      // inside the [10%, 90%] beak zone. Without this slide, a target
      // far below `fixedTop` clamps the beak to 90% — visually it
      // floats next to the tooltip instead of next to the row.
      if (fixedTop !== undefined) {
        const minTopForBeak = targetCenterY - tooltipHeight * 0.9
        const maxTopForBeak = targetCenterY - tooltipHeight * 0.1
        top = Math.max(minTopForBeak, Math.min(maxTopForBeak, fixedTop))
      } else {
        top = targetCenterY - tooltipHeight / 2
      }

      // Clamp to viewport
      if (left + tooltipWidth + gap > viewportWidth) {
        left = viewportWidth - tooltipWidth - gap
      }
      if (top < gap) {
        top = gap
      }
      if (top + tooltipHeight + gap > viewportHeight) {
        top = viewportHeight - tooltipHeight - gap
      }

      // Calculate beak vertical position as percentage. Already inside
      // [10%, 90%] thanks to the slide above, except when viewport
      // clamping forced the tooltip back — re-clamp for safety.
      beakTopPercent = ((targetCenterY - top) / tooltipHeight) * 100
      beakTopPercent = Math.max(10, Math.min(90, beakTopPercent))

      setPosition({ top, left, beakLeftPercent: 0, beakTopPercent })
      setResolvedPlacement('below') // Not really used for side positioning
      setIsPositioned(true)
      return
    }

    // Side positioning (tooltip to the left of target)
    if (side === 'left') {
      // Position tooltip to the left of the target
      left = targetRect.left - gap - beakWidth - tooltipWidth
      const targetCenterY = targetRect.top + targetRect.height / 2

      // Same slide-to-keep-beak-aligned semantics as `side === 'right'`.
      if (fixedTop !== undefined) {
        const minTopForBeak = targetCenterY - tooltipHeight * 0.9
        const maxTopForBeak = targetCenterY - tooltipHeight * 0.1
        top = Math.max(minTopForBeak, Math.min(maxTopForBeak, fixedTop))
      } else {
        top = targetCenterY - tooltipHeight / 2
      }

      // Clamp to viewport
      if (left < gap) {
        left = gap
      }
      if (top < gap) {
        top = gap
      }
      if (top + tooltipHeight + gap > viewportHeight) {
        top = viewportHeight - tooltipHeight - gap
      }

      beakTopPercent = ((targetCenterY - top) / tooltipHeight) * 100
      beakTopPercent = Math.max(10, Math.min(90, beakTopPercent))

      setPosition({ top, left, beakLeftPercent: 100, beakTopPercent })
      setResolvedPlacement('below') // Not used for side positioning
      setIsPositioned(true)
      return
    }

    // Standard above/below positioning
    const targetCenterX = targetRect.left + targetRect.width / 2
    left = targetCenterX - tooltipWidth / 2

    if (placement === 'above') {
      top = targetRect.top - tooltipHeight - gap - beakHeight + 5
      if (top < gap) {
        top = gap
      }
      nextPlacement = 'above'
    } else if (placement === 'below') {
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
      const aboveTop = targetRect.top - tooltipHeight - gap - beakHeight + 5
      if (aboveTop >= gap) {
        top = aboveTop
        nextPlacement = 'above'
      } else {
        top = targetRect.bottom + gap + beakHeight
        if (top + tooltipHeight + gap > viewportHeight) {
          top = Math.max(gap, viewportHeight - tooltipHeight - gap)
        }
        nextPlacement = 'below'
      }
    }

    // Adjust if tooltip goes off screen horizontally
    const minLeft = gap
    const maxLeft = viewportWidth - tooltipWidth - gap
    if (left < minLeft) {
      left = minLeft
    } else if (left > maxLeft) {
      left = maxLeft
    }

    // Calculate beak position as percentage
    beakLeftPercent = ((targetCenterX - left) / tooltipWidth) * 100

    setPosition({ top, left, beakLeftPercent, beakTopPercent: undefined })
    setResolvedPlacement(nextPlacement)
    setIsPositioned(true)
    
    // Recalculate after the tooltip box settles. The first pass can measure
    // the content BEFORE its final layout (a transiently over-wide box), and
    // the viewport clamp then anchors `left` on that phantom width — visibly
    // stranding the tooltip far from a right-edge target. Re-derive the full
    // horizontal position (centre + clamp), not just the beak, from the
    // final rects.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (tooltipRef.current && targetRef.current) {
          const finalTooltipRect = tooltipRef.current.getBoundingClientRect()
          const finalTargetRect = targetRef.current.getBoundingClientRect()
          const finalTargetCenterX = finalTargetRect.left + finalTargetRect.width / 2
          const finalTooltipWidth = finalTooltipRect.width

          let finalLeft = finalTargetCenterX - finalTooltipWidth / 2
          const finalMaxLeft = window.innerWidth - finalTooltipWidth - gap
          if (finalLeft < gap) finalLeft = gap
          else if (finalLeft > finalMaxLeft) finalLeft = finalMaxLeft

          const finalBeakLeftPercent = ((finalTargetCenterX - finalLeft) / finalTooltipWidth) * 100

          setPosition(prev => ({
            ...prev,
            left: finalLeft,
            beakLeftPercent: finalBeakLeftPercent
          }))
        }
      })
    })
  }, [targetRef, placement, side, fixedTop])

  const prevShowRef = useRef(show)
  const prevRepositionKeyRef = useRef(repositionKey)
  useEffect(() => {
    const showChanged = prevShowRef.current !== show
    const keyChanged = prevRepositionKeyRef.current !== repositionKey
    prevShowRef.current = show
    prevRepositionKeyRef.current = repositionKey

    if (show && (showChanged || keyChanged)) {
      // Reset positioning state when becoming visible or reposition key changes
      // Use requestAnimationFrame to defer setState. Every deferred callback's
      // id is tracked so the cleanup cancels the WHOLE chain — otherwise the
      // second-rAF + the two nested setTimeouts kept calling updatePosition()
      // (which setStates) after unmount.
      const rafIds: number[] = []
      const timeoutIds: ReturnType<typeof setTimeout>[] = []
      rafIds.push(requestAnimationFrame(() => {
        setIsPositioned(false)
        setPosition({ top: -9999, left: -9999, beakLeftPercent: 50, beakTopPercent: undefined })
      }))
      // Wait for next frame to ensure tooltip is rendered and has dimensions
      rafIds.push(requestAnimationFrame(() => {
        // Double RAF to ensure layout is complete
        rafIds.push(requestAnimationFrame(() => {
          updatePosition()
          // Recalculate multiple times to ensure final width is set
          timeoutIds.push(setTimeout(() => {
            updatePosition()
            timeoutIds.push(setTimeout(() => {
              updatePosition()
            }, 10))
          }, 10))
        }))
      }))
      return () => {
        for (const id of rafIds) cancelAnimationFrame(id)
        for (const id of timeoutIds) clearTimeout(id)
      }
    } else if (!show && showChanged) {
      const rafId = requestAnimationFrame(() => {
        setIsPositioned(false)
        setPosition({ top: -9999, left: -9999, beakLeftPercent: 50, beakTopPercent: undefined })
      })
      return () => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [show, updatePosition, repositionKey])

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

  return createPortal(
    <div
      ref={tooltipRef}
      className={tooltipClasses}
      {...(dataTestId && { 'data-testid': dataTestId })}
      data-placement={resolvedPlacement}
      data-side={side}
      data-is-positioned={isPositioned ? 'true' : 'false'}
      data-top={String(Math.round(position.top))}
      data-left={String(Math.round(position.left))}
      data-beak-left-percent={String(Math.round(position.beakLeftPercent))}
      {...(position.beakTopPercent !== undefined && {
        'data-beak-top-percent': String(Math.round(position.beakTopPercent))
      })}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 10000,
        opacity: isPositioned ? 1 : 0,
        transition: isPositioned ? 'opacity 100ms linear' : 'none',
        '--beak-left-percent': `${position.beakLeftPercent}%`,
        '--beak-top-percent': position.beakTopPercent !== undefined ? `${position.beakTopPercent}%` : '50%'
      } as React.CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
    >
      <div className="tooltip-content">
        {content}
      </div>
    </div>,
    // Portal into the `.workbench` root when present (else `document.body`) — the
    // SAME root a `ContextMenu` portals to. This keeps a tooltip/popover and a
    // context menu opened from inside it in ONE stacking context, so the menu's
    // higher `z-index` actually paints above the popover (a body-level popover
    // would otherwise trap a workbench-level menu beneath it). The workbench
    // root also carries the app font.
    document.querySelector('.workbench') ?? document.body
  )
}

export default Tooltip
