/**
 * Bridge between the ACTIVE server editor tab and the menu bar's
 * « Serveur » menu: the editor publishes menu equivalents of its own
 * action buttons (start/stop listening, send data, …) while its tab is
 * active, and the titlebar renders whatever is published — the menu
 * exists exactly when a server editor is the active tab, and each entry
 * dispatches to the SAME handler as the button it mirrors (same
 * behaviour, same enablement, same error toasts).
 */

import { useContext, useEffect, useSyncExternalStore } from 'react'
import type { SidebarContextMenuItem } from '../components/MainView/Sidebar/contextMenuBuilder'
import { useWorkbenchTabId } from '../contexts/workbenchTabHost'
import { WorkbenchActiveTabContext } from '../contexts/WorkbenchActiveTabContext'

let current: SidebarContextMenuItem[] | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

/** Publish the active server editor's action entries (or null when the
 * tab leaves the foreground / unmounts). Last writer wins — only the
 * ACTIVE editor should call with a non-null value. */
export function publishServerMenu(items: SidebarContextMenuItem[] | null): void {
  current = items
  notify()
}

export function useServerMenu(): SidebarContextMenuItem[] | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => current
  )
}

/** Whether the calling view's hosting workbench tab is the FOCUSED tab —
 * the publish gate. False outside a tab (conflict/auth modal hosts). */
export function useIsActiveWorkbenchTab(): boolean {
  const hostTabId = useWorkbenchTabId()
  const activeTabId = useContext(WorkbenchActiveTabContext)
  return hostTabId !== null && hostTabId === activeTabId
}

/** Publish `items` while `active` (memoize `items` in the caller — the
 * effect re-runs on identity change), retract on blur/unmount. */
export function useServerMenuPublisher(active: boolean, items: SidebarContextMenuItem[] | null): void {
  useEffect(() => {
    if (!active || !items) return undefined
    publishServerMenu(items)
    return () => { publishServerMenu(null) }
  }, [active, items])
}
