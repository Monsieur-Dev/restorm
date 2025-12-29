import { createContext } from 'react'

export interface VariableDefinition {
  name: string
  value: string
}

export interface AvailableVariablesContextValue {
  /** Get variables for a specific field */
  getVariables: (variableId: string) => VariableDefinition[]
  /** Subscribe to variable updates for a specific field */
  subscribe: (variableId: string, callback: (variables: VariableDefinition[]) => void) => () => void
}

export const AvailableVariablesContext = createContext<AvailableVariablesContextValue | null>(null)
