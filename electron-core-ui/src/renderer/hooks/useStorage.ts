import { useCallback, useEffect, useState } from 'react'
import { logger } from '../services/logger'

interface StorageAPI {
  get: <T>(key: string) => Promise<T | undefined>
  set: <T>(key: string, value: T) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

/**
 * Get the storage API from window.api
 * Returns undefined if not available (e.g., in web-only mode)
 */
export function getStorageAPI(): StorageAPI | undefined {
  const host = window as unknown as { api?: { storage?: StorageAPI } }
  return host.api?.storage
}

/**
 * Hook to load and save a value to persistent storage
 * @param key The storage key
 * @param defaultValue Default value if key doesn't exist
 * @returns [value, setValue, isLoading]
 */
export function useStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void, boolean] {
  const [value, setValueState] = useState<T>(defaultValue)
  const [isLoading, setIsLoading] = useState(true)

  // Load initial value
  useEffect(() => {
    const load = async (): Promise<void> => {
      const api = getStorageAPI()
      if (api) {
        try {
          const stored = await api.get<T>(key)
          if (stored !== undefined) {
            setValueState(stored)
          }
        } catch (error) {
          logger.error('[useStorage] Failed to load value', { key, error: String(error) })
        }
      }
      setIsLoading(false)
    }
    load()
  }, [key])

  // Save value
  const setValue = useCallback(
    (newValue: T) => {
      setValueState(newValue)
      const api = getStorageAPI()
      if (api) {
        api.set(key, newValue).catch((error) => {
          logger.error('[useStorage] Failed to save value', { key, error: String(error) })
        })
      }
    },
    [key]
  )

  return [value, setValue, isLoading]
}

/**
 * Save a value to persistent storage (fire and forget)
 */
export async function saveToStorage<T>(key: string, value: T): Promise<boolean> {
  const api = getStorageAPI()
  if (!api) return false
  try {
    return await api.set(key, value)
  } catch {
    return false
  }
}

/**
 * Load a value from persistent storage
 */
export async function loadFromStorage<T>(key: string): Promise<T | undefined> {
  const api = getStorageAPI()
  if (!api) return undefined
  try {
    return await api.get<T>(key)
  } catch {
    return undefined
  }
}
