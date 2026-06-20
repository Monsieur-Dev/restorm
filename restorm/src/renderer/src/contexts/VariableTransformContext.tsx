import React, { useEffect, useCallback, useRef, useMemo } from 'react'
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
    // Check if Electron APIs are available (not in web mode)
    const restormContext = window.restorm?.context
    if (!restormContext?.onVariableTransformed) {
      return
    }

    const pendingFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()

    const unsubscribe = restormContext.onVariableTransformed((result: VariableTransformResult & { sourceId?: string }) => {
      const { variableId, transformedValue, sourceId } = result

      // Update stored result
      transformResultsRef.current.set(variableId, transformedValue)

      // If this is an own-echo (has sourceId), defer notification to avoid
      // stealing focus from inputs during typing bursts.
      if (sourceId) {
        const existing = pendingFlushTimers.get(variableId)
        if (existing) clearTimeout(existing)
        pendingFlushTimers.set(variableId, setTimeout(() => {
          pendingFlushTimers.delete(variableId)
          const latest = transformResultsRef.current.get(variableId)
          if (latest === undefined) return
          const subs = subscribersRef.current.get(variableId)
          if (subs) { for (const cb of subs) cb(latest) }
        }, 400))
        return
      }

      // Notify all subscribers for this variableId
      const subscribers = subscribersRef.current.get(variableId)
      if (subscribers) {
        for (const callback of subscribers) {
          callback(transformedValue)
        }
      }
    })

    return () => {
      unsubscribe()
      // Clear deferred-flush timers so they don't fire into subscribers after unmount.
      for (const timer of pendingFlushTimers.values()) clearTimeout(timer)
      pendingFlushTimers.clear()
    }
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

  const contextValue = useMemo(() => ({ getTransformResult, subscribe }), [getTransformResult, subscribe])

  return (
    <VariableTransformContext.Provider value={contextValue}>
      {children}
    </VariableTransformContext.Provider>
  )
}
