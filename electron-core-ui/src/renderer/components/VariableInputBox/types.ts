import type React from 'react'

export interface VariableDefinition {
  name: string
  value: string
  description?: string
}

export interface VariableInputBoxProps {
  value: string
  onChange: (value: string) => void
  variables: VariableDefinition[]
  placeholder?: string
  /**
   * Optional resolved value (after Handlebars or other template evaluation).
   * When provided and different from the raw value, it can be shown in a tooltip.
   */
  resolvedValue?: string | undefined
  id?: string
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
  /**
   * Optional callback when user selects "Go to Definition" from context menu.
   * Called with the variable name under the cursor.
   */
  onGoToDefinition?: (variableName: string) => void
}


