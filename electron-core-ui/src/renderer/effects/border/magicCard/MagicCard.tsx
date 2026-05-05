import React, { useEffect, useRef } from 'react'
import './magicCard.css'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/magic-card
// Simplified to a border-tracking spotlight that follows the pointer; CSS vars
// are mutated directly on the DOM to avoid a re-render per pointer move.

export interface MagicCardProps {
  /** Size of the radial spotlight in pixels. */
  gradientSize?: number
  /** First color of the spotlight gradient. */
  gradientFrom?: string
  /** Second color of the spotlight gradient. */
  gradientTo?: string
  /** Blur radius applied to the spotlight, in pixels. */
  blur?: number
  /** Peak opacity of the spotlight when the cursor is over the card (0-1). */
  maxOpacity?: number
}

export const MagicCard: React.FC<MagicCardProps> = ({
  gradientSize = 280,
  gradientFrom = '#9E7AFF',
  gradientTo = '#FE8BBB',
  blur = 32,
  maxOpacity = 0.4
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const maxOpacityRef = useRef(maxOpacity)

  useEffect(() => {
    maxOpacityRef.current = maxOpacity
  }, [maxOpacity])

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const parent = el.parentElement
    if (!parent) return undefined

    const off = -gradientSize
    el.style.setProperty('--ecu-magic-x', `${off}px`)
    el.style.setProperty('--ecu-magic-y', `${off}px`)
    el.style.setProperty('--ecu-magic-opacity', '0')

    const handleMove = (event: PointerEvent): void => {
      const rect = parent.getBoundingClientRect()
      el.style.setProperty('--ecu-magic-x', `${event.clientX - rect.left}px`)
      el.style.setProperty('--ecu-magic-y', `${event.clientY - rect.top}px`)
      el.style.setProperty('--ecu-magic-opacity', String(maxOpacityRef.current))
    }
    const handleLeave = (): void => {
      el.style.setProperty('--ecu-magic-opacity', '0')
    }

    parent.addEventListener('pointermove', handleMove)
    parent.addEventListener('pointerleave', handleLeave)
    return () => {
      parent.removeEventListener('pointermove', handleMove)
      parent.removeEventListener('pointerleave', handleLeave)
    }
  }, [gradientSize])

  const style: React.CSSProperties = {
    ['--ecu-magic-size' as string]: `${gradientSize}px`,
    ['--ecu-magic-from' as string]: gradientFrom,
    ['--ecu-magic-to' as string]: gradientTo,
    ['--ecu-magic-blur' as string]: `${blur}px`
  }

  return <div ref={ref} className="ecu-border-effect ecu-magic-card" style={style} />
}
