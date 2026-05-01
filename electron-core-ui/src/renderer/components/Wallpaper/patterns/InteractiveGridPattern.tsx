import React, { useEffect, useRef, useState } from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/interactive-grid-pattern
// Hover handled in pure CSS so we don't pay a useState per pointer move.

export interface InteractiveGridPatternProps {
  /** Cell width and height in pixels. */
  cellSize?: number
  /** Stroke opacity of the grid lines (0-1). */
  strokeOpacity?: number
  /** Fill opacity of a square on hover (0-1). */
  hoverOpacity?: number
  /** Color used for both the strokes and the hover fill. */
  color?: string
  className?: string
  style?: React.CSSProperties
}

export const InteractiveGridPattern: React.FC<InteractiveGridPatternProps> = ({
  cellSize = 40,
  strokeOpacity = 0.3,
  hoverOpacity = 0.3,
  color,
  className,
  style
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Map<number, SVGRectElement>>(new Map())
  const hoveredIndexRef = useRef<number | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

  const horizontal = size.width > 0 ? Math.ceil(size.width / cellSize) : 0
  const vertical = size.height > 0 ? Math.ceil(size.height / cellSize) : 0
  const total = horizontal * vertical

  // Track the cursor at the document level so the highlight follows it even
  // when an opaque overlay (e.g. a Vignette) sits between the cursor and the
  // grid. The DOM is mutated directly to avoid a re-render per pointer move.
  useEffect(() => {
    const el = containerRef.current
    if (!el || horizontal === 0 || vertical === 0) return undefined

    const setHovered = (next: number | null): void => {
      const prev = hoveredIndexRef.current
      if (prev === next) return
      if (prev !== null) {
        const prevEl = cellRefs.current.get(prev)
        prevEl?.removeAttribute('data-hovered')
      }
      if (next !== null) {
        const nextEl = cellRefs.current.get(next)
        nextEl?.setAttribute('data-hovered', 'true')
      }
      hoveredIndexRef.current = next
    }

    const handleMove = (event: MouseEvent): void => {
      const rect = el.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) {
        setHovered(null)
        return
      }
      const col = Math.floor(x / cellSize)
      const row = Math.floor(y / cellSize)
      if (col < 0 || col >= horizontal || row < 0 || row >= vertical) {
        setHovered(null)
        return
      }
      setHovered(row * horizontal + col)
    }

    const handleLeave = (): void => { setHovered(null) }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseleave', handleLeave)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseleave', handleLeave)
      setHovered(null)
    }
  }, [cellSize, horizontal, vertical])

  const rootClass = ['ecu-wallpaper-pattern-interactive-grid', className].filter(Boolean).join(' ')
  const rootStyle: React.CSSProperties = {
    ['--ecu-igrid-stroke-opacity' as string]: String(strokeOpacity),
    ['--ecu-igrid-hover-opacity' as string]: String(hoverOpacity),
    ...style
  }
  if (color !== undefined) rootStyle.color = color

  return (
    <div ref={containerRef} className={rootClass} style={rootStyle}>
      {total > 0 ? (
        <svg width="100%" height="100%" aria-hidden="true">
          {Array.from({ length: total }).map((_, index) => {
            const x = (index % horizontal) * cellSize
            const y = Math.floor(index / horizontal) * cellSize
            return (
              <rect
                key={index}
                ref={(node) => {
                  if (node) cellRefs.current.set(index, node)
                  else cellRefs.current.delete(index)
                }}
                className="ecu-wallpaper-pattern-interactive-grid-cell"
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
              />
            )
          })}
        </svg>
      ) : null}
    </div>
  )
}
