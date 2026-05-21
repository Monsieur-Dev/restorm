import React, { useState } from 'react'

/** Time units offered by the wait node's inline duration control. */
export const WAIT_UNITS = ['ms', 's', 'min', 'h'] as const
export type WaitUnit = (typeof WAIT_UNITS)[number]

export interface WaitDurationControlProps {
  value?: number
  unit?: WaitUnit
  onValueChange?: (v: number) => void
  onUnitChange?: (u: WaitUnit) => void
}

/**
 * Inline duration editor for the `wait` node: a numeric field + a compact
 * unit toggle (ms / s / min / h). Shown only when no value is wired into the
 * node's `duration` input. Uncontrolled by default (local state); visual
 * only until the node config schema lands.
 */
export const WaitDurationControl: React.FC<WaitDurationControlProps> = ({ value, unit, onValueChange, onUnitChange }) => {
  const [internalValue, setInternalValue] = useState<string>(value != null ? String(value) : '1000')
  const [internalUnit, setInternalUnit] = useState<WaitUnit>('ms')
  const selectedUnit = unit ?? internalUnit
  return (
    <div className="scn-wait-duration nodrag">
      <input
        type="number"
        min={0}
        className="scn-wait-input"
        value={internalValue}
        onMouseDown={(e) => { e.stopPropagation() }}
        onChange={(e) => {
          setInternalValue(e.target.value)
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onValueChange?.(n)
        }}
      />
      <div className="scn-unit-toggle" role="radiogroup" aria-label="unit">
        {WAIT_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            className={`scn-unit-option ${u === selectedUnit ? 'scn-unit-option-active' : ''}`}
            aria-pressed={u === selectedUnit}
            onClick={(e) => { e.stopPropagation(); setInternalUnit(u); onUnitChange?.(u) }}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  )
}

export default WaitDurationControl
