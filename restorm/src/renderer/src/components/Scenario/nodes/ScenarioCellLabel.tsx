import React, { useRef, useState } from 'react'
import { Tooltip } from 'electron-core-ui/renderer'
import type { ScenarioNodeCell } from './ScenarioNodeBoxBase'

/**
 * A cell's label, wrapped in a hover tooltip when the cell carries one
 * (e.g. a request param's description).
 */
export const ScenarioCellLabel: React.FC<{ cell: ScenarioNodeCell }> = ({ cell }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  if (!cell.tooltip) return <span className="scn-port-label">{cell.label}</span>
  return (
    <>
      <span ref={ref} className="scn-port-label" onMouseEnter={() => { setHover(true) }} onMouseLeave={() => { setHover(false) }}>
        {cell.label}
      </span>
      <Tooltip targetRef={ref} show={hover} placement="auto" side="auto" content={cell.tooltip} />
    </>
  )
}

export default ScenarioCellLabel
