import { useExclusivePopover } from 'electron-core-ui/renderer'

/**
 * Mutual exclusion for the request-header click popovers (quick settings,
 * environment, auth route, scenarios-using-request, scenario callers, …):
 * opening one must close the others, otherwise two anchored tooltips stack
 * on top of each other.
 *
 * Delegates to the shared library primitive rather than owning a second
 * channel. That matters because several popovers in the same header row —
 * the bookmark/tag ribbon editors, the icon picker — are library
 * components that own their open state and their content internally, so
 * they cannot reach an application-level hook. One channel is what makes
 * the whole row a single set; two would silently split it in half, which
 * is precisely the failure this exists to prevent.
 */
export function useExclusiveHeaderPopover(open: boolean, close: () => void): void {
  useExclusivePopover(open, close)
}

export default useExclusiveHeaderPopover
