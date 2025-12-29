import { useContext, useEffect, useState } from 'react'
import { AvailableVariablesContext, type VariableDefinition } from '../contexts/availableVariablesContextValue'

/**
 * Hook to get available variables for a specific field
 * @param variableId - The unique ID of the field
 * @returns Array of available variables that updates when variables change
 */
export function useAvailableVariables(variableId: string | undefined): VariableDefinition[] {
  const context = useContext(AvailableVariablesContext)
  // Initialize with current value from context to avoid setState in effect
  const [variables, setVariables] = useState<VariableDefinition[]>(() => {
    if (!context || !variableId) return []
    return context.getVariables(variableId)
  })

  useEffect(() => {
    if (!context || !variableId) return

    // Subscribe to updates
    const unsubscribe = context.subscribe(variableId, (newVariables) => {
      setVariables(prev => {
        // Avoid unnecessary re-renders
        if (prev.length !== newVariables.length) return newVariables
        const hasChanges = newVariables.some((v, i) => {
          const prevItem = prev[i]
          return prevItem && (prevItem.name !== v.name || prevItem.value !== v.value)
        })
        return hasChanges ? newVariables : prev
      })
    })

    return unsubscribe
  }, [context, variableId])

  return variables
}
