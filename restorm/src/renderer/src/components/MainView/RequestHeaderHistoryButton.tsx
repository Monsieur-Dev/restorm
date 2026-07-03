import React from 'react'
import { useTranslation } from 'react-i18next'
import { Button, eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { HeaderHoverTooltip } from './HeaderHoverTooltip'

export interface RequestHeaderHistoryButtonProps {
  /** Request whose response history the modal should show. Emitting the
   * open event with this id keeps the modal scoped to this tab — the
   * matching `*RequestTabView` listens for its own request id. */
  requestId: string
}

/**
 * Request tab-header button (codicon only, compact) that opens the
 * response history modal for the current request. Replaces the statusbar
 * history cell; the click emits `REQUEST_HISTORY_OPEN`, which the active
 * request tab view catches to open its own (tab-scoped) modal.
 */
export const RequestHeaderHistoryButton: React.FC<RequestHeaderHistoryButtonProps> = ({ requestId }) => {
  const { t } = useTranslation()
  const label = t('statusbar.requestHistory')
  return (
    <HeaderHoverTooltip label={label} data-testid={`request-header-history-tooltip-${requestId}`}>
      <Button
        small
        icon="history"
        className="request-header-history-button"
        data-testid={`request-header-history-button-${requestId}`}
        onClick={(e) => {
          e.stopPropagation()
          eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_OPEN, { requestId } as RequestHistoryEventPayload)
        }}
      />
    </HeaderHoverTooltip>
  )
}

export default RequestHeaderHistoryButton
