import React, { useState } from 'react'
import { WAIT_UNITS, type WaitUnit } from './waitUnits'

export interface WaitDurationControlProps {
  value?: number
  unit?: WaitUnit
  /** Render ONLY the unit toggle (no numeric field). Used when the
   * `duration` port is wired: the value comes from upstream, but the
   * unit still needs to say how to read it (s / ms / min / h). */
  unitOnly?: boolean
  onValueChange?: (v: number) => void
  onUnitChange?: (u: WaitUnit) => void
}

/**
 * Inline duration editor for the `wait` node: a numeric field + a compact
 * unit toggle (ms / s / min / h). When `unitOnly` is set the numeric field is
 * dropped and only the unit toggle shows — that's the wired case, where the
 * value arrives on the `duration` port and the toggle declares its unit.
 */
export const WaitDurationControl: React.FC<WaitDurationControlProps> = ({ value, unit, unitOnly, onValueChange, onUnitChange }) => {
  const [internalValue, setInternalValue] = useState<string>(value != null ? String(value) : '1000')
  // Re-sync the field when the persisted value changes underneath us
  // (compare-and-set in render — no effect, no clobbering mid-type).
  const [lastValueProp, setLastValueProp] = useState<number | undefined>(value)
  if (value !== lastValueProp) {
    setLastValueProp(value)
    if (value != null) setInternalValue(String(value))
  }
  const selectedUnit: WaitUnit = unit ?? 'ms'
  return (
    <div className="scn-wait-duration nodrag">
      {unitOnly !== true && (
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
      )}
      <div className="scn-unit-toggle" role="radiogroup" aria-label="unit">
        {WAIT_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            className={`scn-unit-option ${u === selectedUnit ? 'scn-unit-option-active' : ''}`}
            aria-pressed={u === selectedUnit}
            onMouseDown={(e) => { e.stopPropagation() }}
            onClick={(e) => { e.stopPropagation(); onUnitChange?.(u) }}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  )
}

export default WaitDurationControl
