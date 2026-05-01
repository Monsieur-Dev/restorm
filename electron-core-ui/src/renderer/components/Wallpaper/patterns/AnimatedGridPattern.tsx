import React, { useEffect, useId, useRef, useState } from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/animated-grid-pattern
// Animation reimplemented with CSS keyframes to avoid a runtime dependency on motion.

export interface AnimatedGridPatternProps {
  /** Width of each grid cell, in pixels. */
  width?: number
  /** Height of each grid cell, in pixels. */
  height?: number
  /** X offset of the pattern (used to bleed the grid past the visible edge). */
  x?: number
  /** Y offset of the pattern. */
  y?: number
  /** Stroke dash array applied to the grid lines (0 = solid). */
  strokeDasharray?: number
  /** Number of highlighted squares animated on top of the grid. */
  numSquares?: number
  /** Peak opacity of an animated square. */
  maxOpacity?: number
  /** Duration of one fade-in / fade-out cycle, in seconds. */
  duration?: number
  /** Delay between fade-in and fade-out, in seconds (held at peak opacity). */
  repeatDelay?: number
  /** Color used for both grid lines and animated squares. */
  color?: string
  className?: string
  style?: React.CSSProperties
}

interface Square {
  id: number
  pos: [number, number]
  iteration: number
}

export const AnimatedGridPattern: React.FC<AnimatedGridPatternProps> = ({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = 0,
  numSquares = 50,
  maxOpacity = 0.5,
  duration = 4,
  repeatDelay = 0.5,
  color,
  className,
  style
}) => {
  const id = useId()
  const containerRef = useRef<SVGSVGElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions((prev) => {
          const w = entry.contentRect.width
          const h = entry.contentRect.height
          if (prev.width === w && prev.height === h) return prev
          return { width: w, height: h }
        })
      }
    })
    resizeObserver.observe(element)
    return () => { resizeObserver.disconnect() }
  }, [])

  const rootClass = ['ecu-wallpaper-pattern-animated-grid', className].filter(Boolean).join(' ')
  const cycleDuration = duration * 2 + repeatDelay
  const rootStyle: React.CSSProperties = { ...style }
  if (color !== undefined) rootStyle.color = color

  return (
    <svg ref={containerRef} aria-hidden="true" className={rootClass} style={rootStyle}>
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path
            d={`M.5 ${height}V.5H${width}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      {dimensions.width > 0 && dimensions.height > 0 && (
        <AnimatedSquares
          key={`${dimensions.width}x${dimensions.height}-${numSquares}`}
          dimensions={dimensions}
          numSquares={numSquares}
          cellWidth={width}
          cellHeight={height}
          x={x}
          y={y}
          maxOpacity={maxOpacity}
          cycleDuration={cycleDuration}
        />
      )}
    </svg>
  )
}

interface AnimatedSquaresProps {
  dimensions: { width: number; height: number }
  numSquares: number
  cellWidth: number
  cellHeight: number
  x: number
  y: number
  maxOpacity: number
  cycleDuration: number
}

const AnimatedSquares: React.FC<AnimatedSquaresProps> = ({
  dimensions,
  numSquares,
  cellWidth,
  cellHeight,
  x,
  y,
  maxOpacity,
  cycleDuration
}) => {
  const pickPos = (): [number, number] => [
    Math.floor((Math.random() * dimensions.width) / cellWidth),
    Math.floor((Math.random() * dimensions.height) / cellHeight)
  ]

  // Lazy state init seeds the squares once when this child mounts (parent
  // re-keys it on dimensions / numSquares changes), keeping setState out of
  // an effect body.
  const [squares, setSquares] = useState<Square[]>(() =>
    Array.from({ length: numSquares }, (_, i) => ({
      id: i,
      pos: pickPos(),
      iteration: 0
    }))
  )

  const updateSquarePosition = (squareId: number): void => {
    setSquares((current) => {
      const target = current[squareId]
      if (target?.id !== squareId) return current
      const next = current.slice()
      next[squareId] = { ...target, pos: pickPos(), iteration: target.iteration + 1 }
      return next
    })
  }

  return (
    <svg x={x} y={y} className="ecu-wallpaper-pattern-animated-grid-overflow">
      {squares.map(({ pos: [squareX, squareY], id: squareId, iteration }, index) => (
        <rect
          key={`${squareId}-${iteration}`}
          className="ecu-wallpaper-pattern-animated-grid-square"
          style={{
            ['--ecu-grid-square-max-opacity' as string]: String(maxOpacity),
            animationDuration: `${cycleDuration}s`,
            animationDelay: `${index * 0.1}s`
          }}
          width={cellWidth - 1}
          height={cellHeight - 1}
          x={squareX * cellWidth + 1}
          y={squareY * cellHeight + 1}
          fill="currentColor"
          strokeWidth="0"
          onAnimationEnd={() => { updateSquarePosition(squareId) }}
        />
      ))}
    </svg>
  )
}
