import type React from 'react'

export interface VariableDefinition {
  name: string
  value: string
  description?: string
}

/**
 * Definition for a Handlebars helper function suggestion
 */
export interface HelperDefinition {
  /** Helper name (e.g., 'uppercase', 'add') */
  name: string
  /** Category for grouping (e.g., 'string', 'math', 'array') */
  category: string
  /** Short description of what the helper does */
  description: string
  /** Syntax example showing how to use the helper */
  syntax: string
  /** Optional usage example with expected output */
  example?: string
}

export interface VariableInputBoxProps {
  value: string
  onChange: (value: string) => void
  variables: VariableDefinition[]
  /**
   * Optional Handlebars helper definitions for autocomplete.
   * These will appear as function suggestions with category grouping.
   */
  helpers?: HelperDefinition[]
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
