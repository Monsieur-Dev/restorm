import React, { useEffect, useCallback, useRef } from 'react'
import { VariableTransformContext } from './variableTransformContextValue'
import type { VariableTransformResult } from '../types/global.d'

interface VariableTransformProviderProps {
  children: React.ReactNode
}

/**
 * Provider that manages a single IPC subscription for variable transformations
 * and dispatches updates to interested components via callbacks
 */
export function VariableTransformProvider({ children }: VariableTransformProviderProps): React.ReactElement {
  // Store transform results per variable
  const transformResultsRef = useRef<Map<string, string>>(new Map())
  // Store subscribers per variable
  const subscribersRef = useRef<Map<string, Set<(transformedValue: string) => void>>>(new Map())

  // Set up single IPC subscription
  useEffect(() => {
    const unsubscribe = window.restorm.context.onVariableTransformed((result: VariableTransformResult) => {
      const { variableId, transformedValue } = result
      
      // Update stored result
      transformResultsRef.current.set(variableId, transformedValue)
      
      // Notify all subscribers for this variableId
      const subscribers = subscribersRef.current.get(variableId)
      if (subscribers) {
        for (const callback of subscribers) {
          callback(transformedValue)
        }
      }
    })

    return unsubscribe
  }, [])

  const getTransformResult = useCallback((variableId: string): string | undefined => {
    return transformResultsRef.current.get(variableId)
  }, [])

  const subscribe = useCallback((variableId: string, callback: (transformedValue: string) => void): (() => void) => {
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

  return (
    <VariableTransformContext.Provider value={{ getTransformResult, subscribe }}>
      {children}
    </VariableTransformContext.Provider>
  )
}
