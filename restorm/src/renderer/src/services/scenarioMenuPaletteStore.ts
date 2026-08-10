/**
 * Bridge between the ACTIVE scenario editor tab and the menu bar's
 * « Scénario » menu: the editor publishes its empty-canvas palette (the same
 * items its right-click shows) while its tab is active, and the titlebar
 * renders whatever is published — the menu exists exactly when a scenario
 * editor is the active tab, and its entries stay identical to the canvas
 * palette by construction.
 */

import { useSyncExternalStore } from 'react'
import type { SidebarContextMenuItem } from '../components/MainView/Sidebar/contextMenuBuilder'

let current: SidebarContextMenuItem[] | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

/** Publish the active scenario tab's palette (or null when the tab leaves
 * the foreground / unmounts). Last writer wins — only the ACTIVE editor
 * should call with a non-null value. */
export function publishScenarioMenuPalette(items: SidebarContextMenuItem[] | null): void {
  current = items
  notify()
}

export function useScenarioMenuPalette(): SidebarContextMenuItem[] | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => current
  )
}
