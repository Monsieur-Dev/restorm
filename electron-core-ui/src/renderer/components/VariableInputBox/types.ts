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
  id?: string
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
}


