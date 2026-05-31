import { createContext } from 'react'

/**
 * The id of the workbench tab currently focused/active (the focused split
 * group's active tab), or null. Lets a tab's content — e.g. a scenario editor —
 * tell whether IT is the active tab, so keyboard shortcuts (F5/F6/F7/F8/F9…)
 * and the Delete key act ONLY on the focused tab and never on a background
 * split. Provided by `RestormWorkbench` (the focused split-group's active tab,
 * derived from its `tree` + `focusedGroupId`); reactive, so it bypasses the
 * memoization in the workbench's tab-content renderer (a prop would be frozen
 * by that cache).
 */
export const WorkbenchActiveTabContext = createContext<string | null>(null)
