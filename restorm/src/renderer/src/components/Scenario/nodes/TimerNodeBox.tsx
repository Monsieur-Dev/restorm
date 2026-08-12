import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { SegmentedToggle } from './SegmentedToggle'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue, NumericValue, DateTimeValue } from '../../../../../shared/types/collections'
import { NUMERIC_VALUE_EXCLUDE, STRING_VALUE_EXCLUDE, DATE_PICK_VALUE_EXCLUDE } from './valueTypePolicies'

const MODES = ['frequency', 'cron'] as const
const TIME_UNITS = ['s', 'min', 'h'] as const
const STOP_MODES = ['none', 'duration', 'endDate'] as const

/**
 * `timer` — fires its `tick` body on each interval: a frequency (number + unit)
 * OR a `cron` expression. Optionally bounded by a total duration or an end date;
 * otherwise it runs until the run is stopped. Frequency, cron, duration and
 * endDate are all wireable input ports. The output `tick` drives the loop body.
 */
export const TimerNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const mode = config['mode'] === 'cron' ? 'cron' : 'frequency'
  const unit = (TIME_UNITS as readonly string[]).includes(config['unit'] as string) ? (config['unit'] as string) : 's'
  const durationUnit = (TIME_UNITS as readonly string[]).includes(config['durationUnit'] as string) ? (config['durationUnit'] as string) : 's'
  const stopMode = (STOP_MODES as readonly string[]).includes(config['stopMode'] as string) ? (config['stopMode'] as string) : 'none'

  const rows: ScenarioNodeCell[] = [
    {
      id: 'mode',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.timer.mode', 'mode')}</div>
          <SegmentedToggle
            options={MODES}
            labels={MODES.map((m) => t(`scenario.timer.modeOpt.${m}`, m))}
            value={mode}
            onChange={(next) => { data.onSetConfig?.(id, { mode: next }) }}
            ariaLabel={t('scenario.timer.mode', 'mode')}
          />
        </div>
      )
    }
  ]

  if (mode === 'frequency') {
    rows.push({
      id: 'frequency',
      label: t('scenario.timer.frequency', 'frequency'),
      port: { id: 'frequency', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-num-unit-row">
            <TypedValueField
              value={config['frequency'] !== undefined ? normalizeValueType(config['frequency']) : new NumericValue(1, 'decimal')}
              onChange={(next) => { data.onSetConfig?.(id, { frequency: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              excludeTypes={NUMERIC_VALUE_EXCLUDE}
              allowAllVariables
              dataTestId={`scn-timer-frequency-${id}`}
            />
            <SegmentedToggle
              options={TIME_UNITS}
              value={unit}
              onChange={(next) => { data.onSetConfig?.(id, { unit: next }) }}
              ariaLabel={t('scenario.timer.unit', 'unit')}
            />
          </div>
        </div>
      )
    })
  } else {
    rows.push({
      id: 'cron',
      label: t('scenario.timer.cron', 'cron'),
      port: { id: 'cron', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['cron'] !== undefined ? normalizeValueType(config['cron']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { cron: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={STRING_VALUE_EXCLUDE}
            allowAllVariables
            dataTestId={`scn-timer-cron-${id}`}
          />
        </div>
      )
    })
  }

  rows.push({
    id: 'stopMode',
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t('scenario.timer.stop', 'stop after')}</div>
        <SegmentedToggle
          options={STOP_MODES}
          labels={STOP_MODES.map((m) => t(`scenario.timer.stopOpt.${m}`, m))}
          value={stopMode}
          onChange={(next) => { data.onSetConfig?.(id, { stopMode: next }) }}
          ariaLabel={t('scenario.timer.stop', 'stop after')}
        />
      </div>
    )
  })

  if (stopMode === 'duration') {
    rows.push({
      id: 'duration',
      label: t('scenario.timer.duration', 'duration'),
      port: { id: 'duration', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-num-unit-row">
            <TypedValueField
              value={config['duration'] !== undefined ? normalizeValueType(config['duration']) : new NumericValue(0, 'decimal')}
              onChange={(next) => { data.onSetConfig?.(id, { duration: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              excludeTypes={NUMERIC_VALUE_EXCLUDE}
              allowAllVariables
              dataTestId={`scn-timer-duration-${id}`}
            />
            <SegmentedToggle
              options={TIME_UNITS}
              value={durationUnit}
              onChange={(next) => { data.onSetConfig?.(id, { durationUnit: next }) }}
              ariaLabel={t('scenario.timer.unit', 'unit')}
            />
          </div>
        </div>
      )
    })
  }

  if (stopMode === 'endDate') {
    rows.push({
      id: 'endDate',
      label: t('scenario.timer.endDate', 'end date'),
      port: { id: 'endDate', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['endDate'] !== undefined ? normalizeValueType(config['endDate']) : new DateTimeValue(new Date(), 'yyyy-MM-dd HH:mm:ss')}
            onChange={(next) => { data.onSetConfig?.(id, { endDate: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={DATE_PICK_VALUE_EXCLUDE}
            allowAllVariables
            dataTestId={`scn-timer-enddate-${id}`}
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'tick', label: t('scenario.timer.tick', 'tick'), port: { id: 'tick', role: 'then', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
