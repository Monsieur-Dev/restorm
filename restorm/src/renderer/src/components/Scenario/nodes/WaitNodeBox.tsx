import React from 'react'
import { useNodeConnections, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { WaitDurationControl } from './WaitDurationControl'
import { WAIT_UNIT_MS, isWaitUnit, type WaitUnit } from './waitUnits'

/**
 * `wait` node — delays the flow by a fixed duration. The duration is an
 * optional input: wire a value into the `duration` port, or, when nothing is
 * connected, set it inline with a numeric field + unit (ms / s / min / h).
 *
 * When the `duration` port is wired the numeric field gives way to the
 * JSON-path selector on the edge, but the **unit toggle stays** on its own
 * row so the user can still declare in which unit the incoming value is
 * expressed (an API cooldown is usually in seconds). The chosen unit
 * persists as `inputUnit` and the engine scales the wired value by it.
 * Runnable on its own (no required input).
 */
export const WaitNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const durationConnections = useNodeConnections({ handleType: 'target', handleId: 'duration' })
  const durationWired = durationConnections.length > 0
  const config = data.config ?? {}

  // Inline (unwired) literal: a value expressed in `unit`, persisted both as
  // the raw value + unit (to re-display) and as `durationMs` (what the
  // executor reads).
  const litUnit: WaitUnit = isWaitUnit(config['unit']) ? config['unit'] : 'ms'
  const litValue = typeof config['durationValue'] === 'number'
    ? config['durationValue']
    : (typeof config['durationMs'] === 'number' ? config['durationMs'] : 1000)
  // Wired: the unit the upstream value is expressed in (cooldowns → seconds).
  const inputUnit: WaitUnit = isWaitUnit(config['inputUnit']) ? config['inputUnit'] : 's'

  const rows: ScenarioNodeCell[] = durationWired
    ? [
        { id: 'duration', label: t('scenario.wait.duration', 'duration'), port: { id: 'duration', type: 'target' } },
        {
          id: 'inputUnit',
          content: (
            <WaitDurationControl
              unitOnly
              unit={inputUnit}
              onUnitChange={(u) => { data.onSetConfig?.(id, { inputUnit: u }) }}
            />
          )
        }
      ]
    : [
        {
          id: 'duration',
          content: (
            <WaitDurationControl
              value={litValue}
              unit={litUnit}
              onValueChange={(v) => { data.onSetConfig?.(id, { durationValue: v, durationMs: v * WAIT_UNIT_MS[litUnit] }) }}
              onUnitChange={(u) => { data.onSetConfig?.(id, { unit: u, durationMs: litValue * WAIT_UNIT_MS[u] }) }}
            />
          ),
          port: { id: 'duration', type: 'target' }
        }
      ]

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'out', label: t('scenario.wait.then', 'then'), port: { id: 'out', role: 'then', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default WaitNodeBox
