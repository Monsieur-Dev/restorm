import React, { useState } from 'react'

/** Comparison operators offered by the operator toggle (If + Filter predicate). */
export const OPERATOR_OPTIONS = ['<', '≤', '=', '≥', '>', '≠', 'contains'] as const
export type OperatorOption = (typeof OPERATOR_OPTIONS)[number]

/** Glyph rendered on the toggle per operator. The persisted value is the option
 * key; `contains` shows a compact symbol so the segmented control stays tight
 * (its meaning is carried by the button's `title`). */
const OPERATOR_GLYPH: Record<OperatorOption, string> = {
  '<': '<', '≤': '≤', '=': '=', '≥': '≥', '>': '>', '≠': '≠', contains: '∋'
}

export interface OperatorToggleProps {
  value?: OperatorOption
  onChange?: (op: OperatorOption) => void
}

/**
 * Compact segmented toggle for a comparison operator. Uncontrolled by
 * default (local state); pass `value`/`onChange` to control it. Visual
 * only until the config schema lands.
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
          title={op}
          className={`scn-operator-option ${op === selected ? 'scn-operator-option-active' : ''}`}
          aria-pressed={op === selected}
          aria-label={op}
          onClick={(e) => { e.stopPropagation(); setInternal(op); onChange?.(op) }}
        >
          {OPERATOR_GLYPH[op]}
        </button>
      ))}
    </div>
  )
}

export default OperatorToggle
