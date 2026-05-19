import { useSyncExternalStore } from 'react'

/**
 * Workbench-wide "any sash currently dragging" flag, used by the
 * `EditorWorkbench` to broadcast that one of its own sashes is
 * mid-drag. Subscribers (typically the per-tab content host) flip
 * every tab to `display: none` for the duration so heavy embedded
 * children (Monaco editors, Electron webviews, charts that listen
 * to `ResizeObserver`, …) skip their relayout pass on every
 * mousemove.
 *
 * Implemented as a module-level singleton + `useSyncExternalStore`
 * rather than React Context **on purpose**. A Context.Provider sitting
 * at the root of `EditorWorkbench`'s return value changes the React
 * element type at the top of the rendered tree — when the file
 * hot-reloads, React's reconciler sees `<Provider>` where it
 * previously saw `<div>` and unmounts/remounts the entire workbench
 * subtree. That cascade drops every request tab's `useEffect`
 * cleanup → `context.unregisterRequest`, leaving the renderer's
 * `ContextService` empty until the remount finishes; clicking Send
 * during that window dispatches the raw `{{handlebars}}` URL
 * unresolved.
 *
 * The singleton avoids the structural change. Publishers (the
 * GroupContainer) call `setSashDragging(true | false)`; subscribers
 * read `useIsWorkbenchResizing()` which only re-renders the
 * components that actually care.
 */

let dragging = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return dragging
}

/**
 * Called by the sash drag handlers in `EditorWorkbench`'s
 * `GroupContainer` on `onStart` (true) and `onEnd` (false).
 */
export function setWorkbenchResizing(next: boolean): void {
  if (dragging === next) return
  dragging = next
  for (const listener of listeners) listener()
}

/**
 * Subscribe to the workbench-wide resize flag. Re-renders the
 * consumer when the flag flips. Safe to call from any component;
 * non-workbench consumers always see `false` (no publisher fires).
 */
export function useIsWorkbenchResizing(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Pure helper used by `EditorGroupView` to decide the `display`
 * value of each cached tab body wrapper. Pulled out so it can be
 * unit-tested without spinning up a renderer.
 */
export function computeTabDisplay(isActive: boolean, isResizing: boolean): 'flex' | 'none' {
  if (isResizing) return 'none'
  return isActive ? 'flex' : 'none'
}
