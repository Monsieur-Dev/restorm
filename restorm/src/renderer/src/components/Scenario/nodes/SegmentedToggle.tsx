import React, { useState } from 'react'
import { RadioGroup } from 'electron-core-ui/renderer'

export interface SegmentedToggleProps {
  options: readonly string[]
  /** Display labels parallel to `options` (e.g. translated). Falls back to the
   * raw option string when absent. */
  labels?: readonly string[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  ariaLabel?: string
}

/**
 * Compact segmented control (a row of mutually-exclusive buttons). Used for
 * node operator pickers — comparator (< ≤ = ≥ >), arithmetic (+ − × ÷),
 * boolean (AND OR XOR). Controlled via `value` + `onChange` (persists the node
 * config), or uncontrolled with local state via `defaultValue`.
 */
export const SegmentedToggle: React.FC<SegmentedToggleProps> = ({ options, labels, value, defaultValue, onChange, ariaLabel }) => {
  const [internal, setInternal] = useState<string>(defaultValue ?? options[0] ?? '')
  const selected = value ?? internal
  return (
    <span
      className="scn-operator-toggle-anchor nodrag"
      aria-label={ariaLabel ?? 'options'}
      onClick={(e) => { e.stopPropagation() }}
      onMouseDown={(e) => { e.stopPropagation() }}
    >
      <RadioGroup
        className="scn-operator-toggle nodrag"
        options={{ items: options.map((op, i) => ({ text: labels?.[i] ?? op, isActive: op === selected })) }}
        onSelect={(i) => { const op = options[i]; if (op !== undefined) { setInternal(op); onChange?.(op) } }}
      />
    </span>
  )
}

export default SegmentedToggle
