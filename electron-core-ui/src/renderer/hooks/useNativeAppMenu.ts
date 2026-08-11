import { useEffect, useRef } from 'react'
import type React from 'react'
import { buildNativeMenuTemplate } from '../utils/menuTemplate'

/**
 * Publish a MenuBar JSX tree as the host's native application menu.
 *
 * macOS renders application menus in the system bar, outside the window, so
 * the in-window MenuBar is not shown there. Rather than maintaining a second
 * menu definition, this derives the native menu from the *same* JSX: labels,
 * accelerators, ordering and conditional entries therefore cannot drift.
 *
 * Only serializable data crosses to the main process; `onClick` handlers stay
 * here, keyed by item id, and run when main echoes `native-menu:invoke` back.
 *
 * @param menuJsx - the MenuBar element to mirror
 * @param enabled - publish only when true (i.e. on macOS)
 */
export const useNativeAppMenu = (menuJsx: React.ReactNode, enabled: boolean): void => {
  // Handlers are re-derived on every publish; keep them in a ref so the
  // invoke listener always reaches the current closure without resubscribing.
  const handlersRef = useRef<Map<string, () => void>>(new Map())
  // The caller typically passes a fresh JSX object every render, so this effect
  // re-runs constantly. Rebuilding the template is cheap, but re-sending it
  // rebuilds the whole native menu in the main process (and can dismiss an open
  // menu), so gate the IPC on the serialized template actually changing.
  const lastSentRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      lastSentRef.current = undefined
      return
    }
    const { template, handlers } = buildNativeMenuTemplate(menuJsx)
    // Always refresh the handler closures — they capture the latest props even
    // when the visible template (labels/enabled/order) is unchanged.
    handlersRef.current = handlers
    const serialized = JSON.stringify(template)
    if (serialized !== lastSentRef.current) {
      lastSentRef.current = serialized
      void window.api.nativeMenu.set(template)
    }
  }, [menuJsx, enabled])

  useEffect(() => {
    if (!enabled) return
    const dispose = window.api.nativeMenu.onInvoke((id: string) => {
      handlersRef.current.get(id)?.()
    })
    return dispose
  }, [enabled])
}
