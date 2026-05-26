import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { DateTimePicker } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { DateTimeValue } from '../../../../../shared/types/collections'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'

/**
 * `waitUntil` node — blocks until a target date-time. Aligned on `wait`: a
 * header launch trigger, and an inline date-time value (the same text + calendar
 * control the value selector shows for the `dateTime` type, minus the type
 * switch — `until` is always a date-time). {@link ScenarioInputCell} swaps the
 * picker for the JSON-path selector when a data link is wired into `until`.
 * The target persists as a `DateTimeValue` in the node config bag.
 */
export const WaitUntilNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const parsed = config['until'] !== undefined ? normalizeValueType(config['until']) : null
  const dt = parsed instanceof DateTimeValue ? parsed : new DateTimeValue(new Date(), 'yyyy-MM-dd HH:mm:ss')
  const outputMode =
    dt.format === 'unix' || dt.format === 'epoch' || dt.format === 'iso' ? dt.format : 'pattern'
  const pattern = outputMode === 'pattern' ? dt.format : 'yyyy-MM-dd HH:mm:ss'

  const commit = (next: DateTimeValue): void => { data.onSetConfig?.(id, { until: serializeValueForPersistence(next) }) }

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'until',
          label: t('scenario.waitUntil.until', 'until'),
          port: { id: 'until', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <DateTimePicker
                value={dt.value}
                onChange={(nextDate: Date) => { commit(new DateTimeValue(nextDate, dt.format)) }}
                outputMode={outputMode}
                format={pattern}
                onOutputModeChange={(nextMode: 'pattern' | 'unix' | 'epoch' | 'iso') => {
                  commit(new DateTimeValue(dt.value, nextMode === 'pattern' ? pattern : nextMode))
                }}
                onFormatChange={(nextPattern: string) => { commit(new DateTimeValue(dt.value, nextPattern)) }}
                data-testid="scn-waituntil-until"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'out', label: t('scenario.waitUntil.then', 'then'), port: { id: 'out', role: 'then', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} launchInput canPlay />
}

export default WaitUntilNodeBox
