import { createContext, useContext } from 'react'

/**
 * Whether the subtree is rendered inside a workbench tab.
 *
 * A request view is not only shown in a tab: the git-conflict modal renders
 * several of them side by side, and the auth modal renders one standalone.
 * Those hosts have no `.restorm-workbench-tab` to anchor against, so anything
 * that positions itself against the tab — the fixed action bar — must not be
 * rendered there.
 *
 * Asking the host is what makes that decision reliable. The alternative,
 * threading a "am I in a modal" prop through every view, only works for the
 * views that happen to have been given one: several are rendered by the
 * conflict panel WITHOUT it, so the guard would silently do nothing exactly
 * where it is needed.
 *
 * Defaults to `false`: a view rendered somewhere unknown gets the layout that
 * needs no anchor.
 */
export const WorkbenchTabHostContext = createContext<boolean>(false)

/** True when the caller is inside a workbench tab. */
export const useIsInWorkbenchTab = (): boolean => useContext(WorkbenchTabHostContext)
