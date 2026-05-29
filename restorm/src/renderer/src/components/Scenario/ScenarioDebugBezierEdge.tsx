import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import './scenarioDebugBezierEdge.css'

/** Duration of one lap of the travelling beam along the bezier path. The
 * edge sweep is deliberately faster than the box's `BorderBeam` orbit so it
 * reads as "one data/event crossing the link" — a quick whoosh, not a
 * lingering pulse. */
const DEBUG_BEAM_LAP_MS = 750

interface DebugEdgeData extends Record<string, unknown> {
  /** Monotonically-increasing token bumped by the editor each time the
   * inspector toolbar's Debug button is clicked on a node. Each new value
   * fires a single lap of the travelling beam — represents one data /
   * event crossing the link. */
  debugToken?: number
}

/** Bezier scenario edge that fires a single-lap travelling beam along the
 * bezier path whenever its `data.debugToken` increments. The beam is a
 * short stroked segment of the same bezier — animated via
 * `stroke-dashoffset` so it traces the path's curvature exactly (no
 * tangent-aligned rectangle drifting off the bend). The path is normalised
 * with `pathLength={100}` so the dash pattern + animation keyframes are
 * independent of the edge's actual length. */
export const ScenarioDebugBezierEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data
}) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  })
  const token = (data as DebugEdgeData | undefined)?.debugToken ?? 0

  // Compare-and-set in RENDER (not in an effect): React Compiler's
  // `react-hooks/set-state-in-effect` rule blocks the effect-based variant,
  // and this is the textbook prop-driven transition pattern.
  const [lastSeenToken, setLastSeenToken] = useState(0)
  const [activeToken, setActiveToken] = useState(0)
  if (token !== lastSeenToken) {
    setLastSeenToken(token)
    if (token !== 0) setActiveToken(token)
  }
  useEffect(() => {
    if (activeToken === 0) return undefined
    const stopAt = window.setTimeout(() => { setActiveToken(0) }, DEBUG_BEAM_LAP_MS + 50)
    return () => { window.clearTimeout(stopAt) }
  }, [activeToken])

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} {...(markerEnd !== undefined ? { markerEnd } : {})} />
      {activeToken !== 0 && (
        // Trail = a short dashed slice of the same bezier, drawn as a
        // sibling stroke whose `stroke-dashoffset` animates from "just
        // before path start" to "just past path end". We measure the real
        // path length on mount (via the ref) and feed it as CSS custom
        // properties — `pathLength={100}` in CSS dash-arrays is not
        // honoured for animated `stroke-dashoffset` in Chromium when the
        // values carry implicit pixel units, so the only reliable way to
        // sweep the FULL curve is to scale the dash + offset to the real
        // length.
        <BezierBeamTrail
          key={activeToken}
          edgePath={edgePath}
          durationMs={DEBUG_BEAM_LAP_MS}
        />
      )}
    </>
  )
}

/** A single travelling stroked slice along `edgePath`. Lives in its own
 * component so React mounts it fresh on every parent re-key — the path
 * length measurement + CSS-variable wiring then happen exactly once per
 * lap, and the animation plays from the start. */
const BezierBeamTrail: React.FC<{ edgePath: string; durationMs: number }> = ({ edgePath, durationMs }) => {
  const pathRef = useRef<SVGPathElement>(null)
  const [length, setLength] = useState<number | null>(null)
  // `getTotalLength()` is only meaningful once the path is in the DOM, so
  // the measurement runs as a layout effect (synchronous, before paint).
  // The first render draws the stroke with an invisible dash pattern
  // (`0 99999`), then `useLayoutEffect` measures + commits the real
  // pattern + animation BEFORE the browser paints — so the user never
  // sees a flash of the fully-stroked wire.
  useLayoutEffect(() => {
    const el = pathRef.current
    if (!el) return
    setLength(el.getTotalLength())
  }, [edgePath])
  const dashLen = length === null ? 0 : Math.max(12, length * 0.12)
  const gapLen = length === null ? 0 : length + dashLen + 4
  return (
    <path
      ref={pathRef}
      className="scn-edge-beam-stroke"
      d={edgePath}
      fill="none"
      // `0 99999` while we wait for measurement = nothing drawn (no dash to
      // render). Once we know the path length, swap to the real pattern.
      strokeDasharray={length === null ? '0 99999' : `${dashLen} ${gapLen}`}
      style={length === null ? { animationName: 'none' } : {
        animationDuration: `${durationMs}ms`,
        ['--scn-edge-beam-dash-start' as string]: `${dashLen}`,
        ['--scn-edge-beam-dash-end' as string]: `${-(length + 2)}`
      }}
    />
  )
}

export default ScenarioDebugBezierEdge
