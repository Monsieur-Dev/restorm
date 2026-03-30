import React, { useEffect, useCallback, useRef, useMemo } from 'react'
import { AvailableVariablesContext, type VariableDefinition } from './availableVariablesContextValue'

interface AvailableVariablesProviderProps {
  children: React.ReactNode
}

/**
 * Provider that manages a single IPC subscription for available variables
 * and dispatches updates to interested components via callbacks
 */
export function AvailableVariablesProvider({ children }: AvailableVariablesProviderProps): React.ReactElement {
  // Store variables per field
  const variablesMapRef = useRef<Map<string, VariableDefinition[]>>(new Map())
  // Store subscribers per field
  const subscribersRef = useRef<Map<string, Set<(variables: VariableDefinition[]) => void>>>(new Map())

  // Set up single IPC subscription
  useEffect(() => {
    // Check if Electron APIs are available (not in web mode)
    const restormContext = window.restorm?.context
    if (!restormContext?.onAvailableVariables) {
      return
    }

    const unsubscribe = restormContext.onAvailableVariables((result) => {
      const { variableId, variables } = result
      
      // Update stored variables
      variablesMapRef.current.set(variableId, variables)
      
      // Notify all subscribers for this variableId
      const subscribers = subscribersRef.current.get(variableId)
      if (subscribers) {
        for (const callback of subscribers) {
          callback(variables)
        }
      }
    })

    return unsubscribe
  }, [])

  const getVariables = useCallback((variableId: string): VariableDefinition[] => {
    return variablesMapRef.current.get(variableId) ?? []
  }, [])

  const subscribe = useCallback((variableId: string, callback: (variables: VariableDefinition[]) => void): (() => void) => {
    // Get or create subscriber set for this variableId
    let subscribers = subscribersRef.current.get(variableId)
    if (!subscribers) {
      subscribers = new Set()
      subscribersRef.current.set(variableId, subscribers)
    }
    
    // Add subscriber
    subscribers.add(callback)
    
    // Return unsubscribe function
    return () => {
      const subs = subscribersRef.current.get(variableId)
      if (subs) {
        subs.delete(callback)
        if (subs.size === 0) {
          subscribersRef.current.delete(variableId)
        }
      }
    }
  }, [])

  const contextValue = useMemo(() => ({ getVariables, subscribe }), [getVariables, subscribe])

  return (
    <AvailableVariablesContext.Provider value={contextValue}>
      {children}
    </AvailableVariablesContext.Provider>
  )
}
