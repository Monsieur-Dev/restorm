/**
 * useKeyboardShortcut - Hook for registering keyboard shortcuts
 *
 * Provides a React-friendly way to register keyboard shortcuts that
 * automatically clean up when the component unmounts.
 */

import { useEffect, useRef, useCallback } from 'react'
import { keyboardShortcutService, ShortcutHandler } from '../services/KeyboardShortcutService'

/**
 * Hook to register a keyboard shortcut
 * @param shortcut Shortcut string (e.g., "Ctrl+O", "F2") or undefined to disable
 * @param handler Function to call when shortcut is triggered
 * @param enabled Whether the shortcut is enabled (default: true)
 */
export function useKeyboardShortcut(
  shortcut: string | undefined,
  handler: ShortcutHandler,
  enabled = true
): void {
  // Use ref to always have the latest handler without re-registering
  const handlerRef = useRef<ShortcutHandler>(handler)
  
  // Update the ref in an effect to comply with React rules
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  // Stable callback that uses the ref
  const stableHandler = useCallback(() => {
    return handlerRef.current()
  }, [])

  useEffect(() => {
    // Don't register if no shortcut or disabled
    if (!shortcut || !enabled) {
      return
    }

    const unregister = keyboardShortcutService.register(shortcut, stableHandler)

    return () => {
      unregister()
    }
  }, [shortcut, enabled, stableHandler])
}
