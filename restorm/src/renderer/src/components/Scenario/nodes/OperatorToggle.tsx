import React, { useState } from 'react'
import { RadioGroup } from 'electron-core-ui/renderer'

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
    <span
      className="scn-operator-toggle-anchor nodrag"
      aria-label="operator"
      onClick={(e) => { e.stopPropagation() }}
    >
      <RadioGroup
        className="scn-operator-toggle nodrag"
        options={{
          items: OPERATOR_OPTIONS.map((op) => ({
            text: OPERATOR_GLYPH[op],
            tooltip: op,
            isActive: op === selected
          }))
        }}
        onSelect={(i) => { const op = OPERATOR_OPTIONS[i]; if (op) { setInternal(op); onChange?.(op) } }}
      />
    </span>
  )
}

export default OperatorToggle
