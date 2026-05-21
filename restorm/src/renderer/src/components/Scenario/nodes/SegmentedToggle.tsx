import React, { useState } from 'react'

export interface SegmentedToggleProps {
  options: readonly string[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  ariaLabel?: string
}

/**
 * Compact segmented control (a row of mutually-exclusive buttons). Used for
 * node operator pickers — comparator (< ≤ = ≥ >), arithmetic (+ − × ÷),
 * boolean (AND OR XOR). Uncontrolled by default (local state); visual only
 * until the node config schema lands.
 */
export const SegmentedToggle: React.FC<SegmentedToggleProps> = ({ options, value, defaultValue, onChange, ariaLabel }) => {
  const [internal, setInternal] = useState<string>(defaultValue ?? options[0] ?? '')
  const selected = value ?? internal
  return (
    <div className="scn-operator-toggle nodrag" role="radiogroup" aria-label={ariaLabel ?? 'options'}>
      {options.map((op) => (
        <button
          key={op}
          type="button"
          className={`scn-operator-option ${op === selected ? 'scn-operator-option-active' : ''}`}
          aria-pressed={op === selected}
          onClick={(e) => { e.stopPropagation(); setInternal(op); onChange?.(op) }}
        >
          {op}
        </button>
      ))}
    </div>
  )
}

export default SegmentedToggle
