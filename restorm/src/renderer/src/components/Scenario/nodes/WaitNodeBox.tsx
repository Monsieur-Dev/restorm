import React from 'react'
import { useNodeConnections, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { WaitDurationControl } from './WaitDurationControl'

/**
 * `wait` node — delays the flow by a fixed duration. The duration is an
 * optional input: wire a value into the `duration` port, or, when nothing is
 * connected, set it inline with a numeric field + unit (ms / s / min / h).
 * Runnable on its own (no required input).
 */
export const WaitNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const durationConnections = useNodeConnections({ handleType: 'target', handleId: 'duration' })
  const durationWired = durationConnections.length > 0

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        durationWired
          ? { id: 'duration', label: t('scenario.wait.duration', 'duration'), port: { id: 'duration', type: 'target' } }
          : { id: 'duration', content: <WaitDurationControl />, port: { id: 'duration', type: 'target' } }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'out', label: t('scenario.wait.then', 'then'), port: { id: 'out', role: 'then', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} launchInput />
}

export default WaitNodeBox
