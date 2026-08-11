import React from 'react'
import { InputBox, RadioGroup } from 'electron-core-ui/renderer'
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
  const selectedUnit: WaitUnit = unit ?? 'ms'
  return (
    <div className="scn-wait-duration nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
      {unitOnly !== true && (
        <InputBox
          value={value != null ? String(value) : '1000'}
          onChange={(next) => { const n = Number(next); if (!Number.isNaN(n)) onValueChange?.(n) }}
          options={{ type: 'number', min: 0, ariaLabel: 'duration' }}
          data-testid="scn-wait-duration"
        />
      )}
      <span className="scn-unit-toggle-anchor" aria-label="unit" onClick={(e) => { e.stopPropagation() }}>
        <RadioGroup
          className="scn-unit-toggle"
          options={{ items: WAIT_UNITS.map((u) => ({ text: u, isActive: u === selectedUnit })) }}
          onSelect={(i) => { const u = WAIT_UNITS[i]; if (u !== undefined) onUnitChange?.(u) }}
        />
      </span>
    </div>
  )
}
