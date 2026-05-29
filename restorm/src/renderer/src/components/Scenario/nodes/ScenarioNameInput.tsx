import React from 'react'
import { InputBox } from 'electron-core-ui/renderer'

interface ScenarioNameInputProps {
  value: string
  placeholder: string
  onCommit: (next: string) => void
  /** Outline the field red when it's the target of a validation error. */
  invalid?: boolean
  'data-testid'?: string
}

/**
 * Single-line name field for a scenario node. A thin InputBox wrapper: the
 * debounce (instant draft + debounced commit + flush on blur/unmount) lives in
 * InputBox now, so a node name persists without re-rendering and re-persisting
 * the whole scenario on every keystroke. `nodrag` keeps a click in the field
 * from starting a React Flow node drag.
 */
export const ScenarioNameInput: React.FC<ScenarioNameInputProps> = ({
  value,
  placeholder,
  onCommit,
  invalid,
  'data-testid': dataTestId
}) => (
  <InputBox
    className={`scn-name-input nodrag${invalid ? ' scn-field-invalid' : ''}`}
    options={{ placeholder, ariaLabel: placeholder }}
    value={value}
    onChange={onCommit}
    {...(dataTestId ? { 'data-testid': dataTestId } : {})}
  />
)
