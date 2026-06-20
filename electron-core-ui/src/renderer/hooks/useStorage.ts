import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '../services/logger'

interface StorageAPI {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
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
  // Monotonic token: each load (and each setValue) bumps it. A load only applies
  // its result if its token is still current — so a slow load can't clobber a
  // value the user set, or an earlier key's value, after the fact.
  const loadTokenRef = useRef(0)

  // Load initial value (re-runs on key change)
  useEffect(() => {
    const token = ++loadTokenRef.current
    const load = async (): Promise<void> => {
      // Re-enter the loading state for this key (inside the async body so it's
      // not a synchronous setState in the effect body).
      setIsLoading(true)
      const api = getStorageAPI()
      if (api) {
        try {
          const stored = await api.get(key) as T | undefined
          // Drop a stale load: the key changed or the user set a value while
          // this get() was in flight (lost-update guard).
          if (loadTokenRef.current !== token) return
          if (stored !== undefined) {
            setValueState(stored)
          }
        } catch (error) {
          logger.error('[useStorage] Failed to load value', { key, error: String(error) })
        }
      }
      if (loadTokenRef.current === token) setIsLoading(false)
    }
    void load()
  }, [key])

  // Save value
  const setValue = useCallback(
    (newValue: T) => {
      // Invalidate any in-flight load so its late result can't overwrite this.
      loadTokenRef.current += 1
      setValueState(newValue)
      const api = getStorageAPI()
      if (api) {
        api.set(key, newValue).catch((error: unknown) => {
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
export async function saveToStorage(key: string, value: unknown): Promise<boolean> {
  const api = getStorageAPI()
  if (!api) return false
  try {
    return await api.set(key, value)
  } catch (error) {
    logger.error('[saveToStorage] Failed to save value', { key, error: String(error) })
    return false
  }
}

/**
 * Load a value from persistent storage
 */
export async function loadFromStorage(key: string): Promise<unknown> {
  const api = getStorageAPI()
  if (!api) return undefined
  try {
    return await api.get(key)
  } catch (error) {
    logger.error('[loadFromStorage] Failed to load value', { key, error: String(error) })
    return undefined
  }
}
