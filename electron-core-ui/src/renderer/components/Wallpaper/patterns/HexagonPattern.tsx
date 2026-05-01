import React, { useId } from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/hexagon-pattern

export type HexagonDirection = 'horizontal' | 'vertical'

export interface HexagonPatternProps {
  /** Radius of each hexagon (center to vertex), in pixels. */
  radius?: number
  /** Gap between adjacent hexagons, in pixels (edge-to-edge spacing). */
  gap?: number
  /** Pattern X offset. */
  x?: number
  /** Pattern Y offset. */
  y?: number
  /** Hexagon orientation: flat-top (`horizontal`) or pointy-top (`vertical`). */
  direction?: HexagonDirection
  /** SVG stroke-dasharray applied to each hexagon edge. */
  strokeDasharray?: string
  /** Color of the hexagon outlines. */
  color?: string
  /** Stroke opacity (0-1). */
  strokeOpacity?: number
  className?: string
  style?: React.CSSProperties
}

type HexPoint = readonly [number, number]

function hexVertexList(cx: number, cy: number, r: number, direction: HexagonDirection): HexPoint[] {
  const startAngle = direction === 'horizontal' ? 0 : 30
  return Array.from({ length: 6 }, (_, i) => {
    const angle = ((startAngle + i * 60) * Math.PI) / 180
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const
  })
}

function hexPoints(cx: number, cy: number, r: number, direction: HexagonDirection): string {
  return hexVertexList(cx, cy, r, direction)
    .map(([px, py]) => `${px},${py}`)
    .join(' ')
}

function edgeLexKey(a: HexPoint, b: HexPoint): string {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a]
  return `${p[0].toFixed(6)},${p[1].toFixed(6)}|${q[0].toFixed(6)},${q[1].toFixed(6)}`
}

function collectUniqueHexEdges(
  centers: [number, number][],
  r: number,
  direction: HexagonDirection
): [HexPoint, HexPoint][] {
  const seen = new Set<string>()
  const edges: [HexPoint, HexPoint][] = []
  for (const [cx, cy] of centers) {
    const verts = hexVertexList(cx, cy, r, direction)
    for (let i = 0; i < 6; i++) {
      const a = verts[i]
      const b = verts[(i + 1) % 6]
      if (!a || !b) continue
      const key = edgeLexKey(a, b)
      if (!seen.has(key)) {
        seen.add(key)
        edges.push([a, b])
      }
    }
  }
  return edges
}

function isSolidStrokeDasharray(value: string): boolean {
  const t = value.trim()
  return t === '' || t === 'none' || t === '0'
}

interface HexSpacing {
  colStep: number
  rowStep: number
  tileW: number
  tileH: number
}

function getHexSpacing(r: number, direction: HexagonDirection, gap: number): HexSpacing {
  const sqrt3 = Math.sqrt(3)
  if (direction === 'horizontal') {
    const colStep = (3 * r) / 2 + (sqrt3 * gap) / 2
    const rowStep = sqrt3 * r + gap
    return { colStep, rowStep, tileW: colStep * 2, tileH: rowStep }
  }
  const colStep = sqrt3 * r + gap
  const rowStep = (3 * r) / 2 + (sqrt3 * gap) / 2
  return { colStep, rowStep, tileW: colStep, tileH: rowStep * 2 }
}

interface TileGeometry {
  tileW: number
  tileH: number
  centers: [number, number][]
}

function getTileGeometry(r: number, direction: HexagonDirection, gap: number): TileGeometry {
  const { colStep, rowStep, tileW, tileH } = getHexSpacing(r, direction, gap)

  const canonical: [number, number][] =
    direction === 'horizontal'
      ? [
          [colStep / 2, rowStep / 2],
          [(colStep * 3) / 2, rowStep]
        ]
      : [
          [colStep / 2, rowStep / 2],
          [colStep, (rowStep * 3) / 2]
        ]

  const centers: [number, number][] = []
  for (const [cx, cy] of canonical) {
    centers.push([cx, cy])
    if (cy - r < 0) centers.push([cx, cy + tileH])
    if (cy + r > tileH) centers.push([cx, cy - tileH])
    if (cx - r < 0) centers.push([cx + tileW, cy])
    if (cx + r > tileW) centers.push([cx - tileW, cy])
    if (cy - r < 0 && cx - r < 0) centers.push([cx + tileW, cy + tileH])
    if (cy - r < 0 && cx + r > tileW) centers.push([cx - tileW, cy + tileH])
    if (cy + r > tileH && cx - r < 0) centers.push([cx + tileW, cy - tileH])
    if (cy + r > tileH && cx + r > tileW) centers.push([cx - tileW, cy - tileH])
  }

  return { tileW, tileH, centers }
}

export const HexagonPattern: React.FC<HexagonPatternProps> = ({
  radius = 40,
  gap = 0,
  x = -1,
  y = -1,
  strokeDasharray = '0',
  direction = 'horizontal',
  color,
  strokeOpacity = 0.4,
  className,
  style
}) => {
  const id = useId()
  const { tileW, tileH, centers } = getTileGeometry(radius, direction, gap)
  const solidStroke = isSolidStrokeDasharray(strokeDasharray)
  const dashedEdges = solidStroke ? null : collectUniqueHexEdges(centers, radius, direction)

  const rootClass = ['ecu-wallpaper-pattern-hexagon', className].filter(Boolean).join(' ')
  const rootStyle: React.CSSProperties = { ...style }
  if (color !== undefined) rootStyle.color = color

  return (
    <svg aria-hidden="true" className={rootClass} style={rootStyle}>
      <defs>
        <pattern
          id={id}
          width={tileW}
          height={tileH}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          {solidStroke
            ? centers.map(([cx, cy]) => (
                <polygon
                  key={`${cx}-${cy}`}
                  points={hexPoints(cx, cy, radius, direction)}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={strokeOpacity}
                  strokeDasharray={strokeDasharray}
                />
              ))
            : dashedEdges?.map(([a, b]) => (
                <line
                  key={edgeLexKey(a, b)}
                  x1={a[0]}
                  x2={b[0]}
                  y1={a[1]}
                  y2={b[1]}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={strokeOpacity}
                  strokeDasharray={strokeDasharray}
                />
              ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} stroke="none" />
    </svg>
  )
}
