import { createContext, useContext } from 'react'

/**
 * Imperative API exposed to the tooltip content rendered inside a
 * `StatusbarElement` when `tooltipTrigger === 'click'`. Lets the
 * popover content close itself after a user action (e.g. an env
 * picker that should dismiss as soon as the user clicks an env, but
 * stay open while they toggle "Apply to all"). Without this, the
 * tooltip relies entirely on outside-click / Escape to close, which
 * forces the user to make a second gesture just to acknowledge the
 * selection they already made.
 *
 * `closeTooltip` is a no-op when no provider is in scope, so
 * unconditional `useStatusbarTooltip()` calls in popover content
 * stay safe in hover-mode tooltips and in tests.
 */
export interface StatusbarTooltipContextValue {
  closeTooltip: () => void
}

export const StatusbarTooltipContext = createContext<StatusbarTooltipContextValue>({
  closeTooltip: () => undefined
})

export function useStatusbarTooltip(): StatusbarTooltipContextValue {
  return useContext(StatusbarTooltipContext)
}
