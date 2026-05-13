import { createContext, useContext } from 'react'

/**
 * Workbench-wide flag broadcast by the `EditorWorkbench`'s sashes
 * while one of them is being dragged. Subscribers (typically the
 * per-tab content host) flip every tab to `display: none` for the
 * duration so that heavy embedded children (Monaco editors, Electron
 * webviews, charts that listen to `ResizeObserver`, …) skip their
 * relayout pass on every mousemove.
 *
 * The default value here makes the context safe to consume from a
 * test or storybook context where no provider has wrapped the tree:
 * `isResizing` is always `false` and `setResizing` is a no-op.
 */
export interface WorkbenchResizeContextValue {
  isResizing: boolean
  setResizing: (resizing: boolean) => void
}

export const WorkbenchResizeContext = createContext<WorkbenchResizeContextValue>({
  isResizing: false,
  setResizing: () => undefined
})

export function useWorkbenchResize(): WorkbenchResizeContextValue {
  return useContext(WorkbenchResizeContext)
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
