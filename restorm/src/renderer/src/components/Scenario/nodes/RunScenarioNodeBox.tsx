import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { isScenario } from '../../../../../shared/types/collections'
import { Badge } from '../../common/Badge'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/**
 * `runScenario` node — runs a sub-scenario bound by id
 * (`config.scenarioId`). Its header shows the SCENARIO badge + the live
 * scenario name (resolved from the tree, so a rename follows here);
 * `config.label` is a fallback for when the scenario has been deleted.
 */
export const RunScenarioNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const resolve = useScenarioBoundResolver()
  const scenarioId = typeof data.config?.['scenarioId'] === 'string' ? data.config['scenarioId'] : undefined
  const item = scenarioId && resolve ? resolve(scenarioId) : null
  const scenario = item && isScenario(item) ? item : null

  const fallbackLabel = typeof data.config?.['label'] === 'string' ? data.config['label'] : undefined
  const title = scenario?.name ?? fallbackLabel
  const headerIcon = scenario ? <Badge type="SCENARIO" /> : undefined

  // The launch trigger is the generic header input; the body just exposes the result.
  const left: ScenarioNodeSection[] = []
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: 'result', port: { id: 'result', role: 'response', type: 'source' } }
  ]
  return (
    <ScenarioNodeBoxBase
      id={id}
      data={data}
      selected={selected}
      left={left}
      right={right}
      launchInput
      canPlay
      {...(headerIcon ? { headerIcon } : {})}
      {...(title ? { title } : {})}
    />
  )
}

export default RunScenarioNodeBox
