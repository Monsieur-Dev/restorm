import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { isScenario } from '../../../../../shared/types/collections'
import { Badge } from '../../common/Badge'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { namedParams } from './runScenarioPorts'

/**
 * `runScenario` node — runs a sub-scenario bound by id (`config.scenarioId`),
 * invoked like a function. Its header shows the SCENARIO badge + the live
 * scenario name (a rename follows here); `config.label` is a fallback when the
 * scenario is deleted. Its ports are **derived from the reference**: one input
 * port per named `input` node of the sub-scenario and one output port per named
 * `output` node, so the call signature tracks the sub-scenario's params +
 * outputs. The header launch trigger (`in`) sequences the call.
 */
export const RunScenarioNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const resolve = useScenarioBoundResolver()
  const scenarioId = typeof data.config?.['scenarioId'] === 'string' ? data.config['scenarioId'] : undefined
  const item = scenarioId && resolve ? resolve(scenarioId) : null
  const scenario = item && isScenario(item) ? item : null

  const fallbackLabel = typeof data.config?.['label'] === 'string' ? data.config['label'] : undefined
  const title = scenario?.name ?? fallbackLabel
  const headerIcon = scenario ? <Badge type="SCENARIO" /> : undefined

  const inputNames = namedParams(scenario, 'input')
  const outputNames = namedParams(scenario, 'output')

  const rows: ScenarioNodeCell[] = []
  // First body line: a link to open the bound sub-scenario in a workbench tab.
  if (scenario && scenarioId && data.onOpenItem) {
    rows.push({
      id: 'edit',
      content: (
        <button
          type="button"
          className="scn-edit-link nodrag"
          data-testid="scn-runscenario-edit-link"
          onClick={(e) => { e.stopPropagation(); data.onOpenItem?.(scenarioId) }}
        >
          {t('scenario.editScenario', 'Edit scenario')}
        </button>
      )
    })
  }
  // One input port per named `input` node of the sub-scenario.
  for (const name of inputNames) {
    rows.push({ id: `param:${name}`, label: name, port: { id: `param:${name}`, type: 'target' } })
  }
  const left: ScenarioNodeSection[] = rows.length > 0 ? [{ id: 'main', rows }] : []

  // One output port per named `output` node of the sub-scenario.
  const right: ScenarioNodeCell[] = outputNames.map((name) => ({
    id: `output:${name}`,
    label: name,
    port: { id: `output:${name}`, role: 'response', type: 'source' }
  }))
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
