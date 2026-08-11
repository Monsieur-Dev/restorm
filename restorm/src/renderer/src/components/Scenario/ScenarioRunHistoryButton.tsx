import React from 'react'
import { useTranslation } from 'react-i18next'
import { Button, eventBus } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { SCENARIO_RUN_HISTORY_OPEN, type ScenarioRunHistoryOpenPayload } from './scenarioRunHistoryEvents'

export interface ScenarioRunHistoryButtonProps {
  scenarioId: string
}

/**
 * Scenario tab-header button (codicon only, compact) that opens the
 * persisted run-history overlay. It emits a local event the
 * `ScenarioEditorView` listens for — so the overlay is rendered inside
 * the editor's relative wrapper (scoped to the tab, filling it), not in
 * the small header cluster this button lives in. Hover tooltip is the
 * ECUI info-bulle.
 */
export const ScenarioRunHistoryButton: React.FC<ScenarioRunHistoryButtonProps> = ({ scenarioId }) => {
  const { t } = useTranslation()
  const label = t('scenario.runHistory.tooltip', 'Run history')
  return (
    <HeaderHoverTooltip label={label} data-testid="scenario-run-history-tooltip">
      <Button
        small
        icon="history"
        className="scn-run-history-button"
        data-testid="scenario-run-history-button"
        onClick={(e) => {
          e.stopPropagation()
          eventBus.emitLocalSync(SCENARIO_RUN_HISTORY_OPEN, { scenarioId } as ScenarioRunHistoryOpenPayload)
        }}
      />
    </HeaderHoverTooltip>
  )
}
