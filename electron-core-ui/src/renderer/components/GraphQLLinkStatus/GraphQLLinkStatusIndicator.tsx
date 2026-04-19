import React from 'react'
import StatusbarElement from '../Statusbar/StatusbarElement'
import { useGraphQLLinkStatus } from '../../hooks/useGraphQLLinkStatus'
import type { GraphQLLinkStatus } from '../../services/GraphQLClient'

export interface GraphQLLinkStatusIndicatorProps {
  /** CSS class forwarded to the underlying `<StatusbarElement>` (e.g. `'right-aligned'`). */
  className?: string
  /** Test id for the indicator. Defaults to `statusbar-graphql-link-status`. */
  'data-testid'?: string
  /** Tooltip text shown while reconnecting. */
  reconnectingLabel?: string
  /** Tooltip text shown once the retry budget is exhausted. */
  failedLabel?: string
}

/**
 * Statusbar cell reflecting the health of the renderer's GraphQL
 * subscription link (`graphQLClient.getLinkStatus()`). Hidden when the
 * link is `ok`; renders a subtle spinning / error glyph while
 * `reconnecting` / `failed`.
 *
 * Place inside a `<Statusbar>` like any other `<StatusbarElement>`:
 *
 * ```tsx
 * <Statusbar>
 *   <GraphQLLinkStatusIndicator />
 * </Statusbar>
 * ```
 *
 * Reads its state via `useGraphQLLinkStatus`, so any consumer that just
 * wants the raw value can use that hook directly without rendering this
 * component.
 */
export const GraphQLLinkStatusIndicator: React.FC<GraphQLLinkStatusIndicatorProps> = ({
  className,
  'data-testid': dataTestId = 'statusbar-graphql-link-status',
  reconnectingLabel = 'Live updates reconnecting…',
  failedLabel = 'Live updates unavailable — retrying in background'
}) => {
  const status: GraphQLLinkStatus = useGraphQLLinkStatus()
  if (status === 'ok') return null

  const isFailed = status === 'failed'
  const ariaLabel = isFailed ? failedLabel : reconnectingLabel
  const iconClass = isFailed ? 'codicon codicon-debug-disconnect' : 'codicon codicon-sync codicon-modifier-spin'

  const elementProps: {
    title: React.ReactNode
    warning?: boolean
    error?: boolean
    children: React.ReactNode
    'data-testid': string
    className?: string
  } = {
    title: (
      <span
        aria-label={ariaLabel}
        data-status={status}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <i className={iconClass}></i>
      </span>
    ),
    // `<StatusbarElement>` renders `children` as a tooltip on hover.
    // Use `-tooltip-content` rather than `-tooltip` to avoid clashing
    // with the testid the Tooltip portal itself emits.
    children: <span data-testid={`${dataTestId}-tooltip-content`}>{ariaLabel}</span>,
    'data-testid': dataTestId
  }
  if (isFailed) elementProps.error = true
  else elementProps.warning = true
  if (className !== undefined) elementProps.className = className

  return <StatusbarElement {...elementProps} />
}
