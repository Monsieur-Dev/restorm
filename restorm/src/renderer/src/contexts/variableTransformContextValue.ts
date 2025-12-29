import { createContext } from 'react'
import type { VariableTransformResult } from '../types/global.d'

export interface VariableTransformContextValue {
  /** Get transform result for a specific variable */
  getTransformResult: (variableId: string) => string | undefined
  /** Subscribe to transform result updates for a specific variable */
  subscribe: (variableId: string, callback: (transformedValue: string) => void) => () => void
}

export const VariableTransformContext = createContext<VariableTransformContextValue | null>(null)

export type { VariableTransformResult }
