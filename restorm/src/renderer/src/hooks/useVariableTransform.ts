import { useContext, useEffect, useState } from 'react'
import { VariableTransformContext } from '../contexts/variableTransformContextValue'

/**
 * Hook to get the transformed value for a specific variable
 * @param variableId - The unique ID of the variable
 * @returns The transformed value that updates when the variable is re-transformed
 */
export function useVariableTransform(variableId: string | undefined): string | undefined {
  const context = useContext(VariableTransformContext)
  // Initialize with current value from context
  const [transformedValue, setTransformedValue] = useState<string | undefined>(() => {
    if (!context || !variableId) return undefined
    return context.getTransformResult(variableId)
  })

  useEffect(() => {
    if (!context || !variableId) return

    // Subscribe to updates
    const unsubscribe = context.subscribe(variableId, (newValue) => {
      setTransformedValue(newValue)
    })

    return unsubscribe
  }, [context, variableId])

  return transformedValue
}
