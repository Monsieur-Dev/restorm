import React, { useState } from 'react'

/** Comparison operators offered by the If operator toggle. */
export const OPERATOR_OPTIONS = ['<', '≤', '=', '≥', '>'] as const
export type OperatorOption = (typeof OPERATOR_OPTIONS)[number]

export interface OperatorToggleProps {
  value?: OperatorOption
  onChange?: (op: OperatorOption) => void
}

/**
 * Compact segmented toggle for a comparison operator. Uncontrolled by
 * default (local state); pass `value`/`onChange` to control it. Visual
 * only until the If config schema lands.
 */
export const OperatorToggle: React.FC<OperatorToggleProps> = ({ value, onChange }) => {
  const [internal, setInternal] = useState<OperatorOption>('=')
  const selected = value ?? internal
  return (
    <div className="scn-operator-toggle nodrag" role="radiogroup" aria-label="operator">
      {OPERATOR_OPTIONS.map((op) => (
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

export default OperatorToggle
