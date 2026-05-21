import React, { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Button } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/**
 * `switch` node — routes its (mandatory) input to the first matching case.
 * The right column lists one output per case, each with a textbox for the
 * value to match; the "+" button appends a new case row above it, and a
 * `default` output sits below for the fall-through. Case list is node-local
 * (visual) until the node config schema lands.
 */
export const SwitchNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const [cases, setCases] = useState<string[]>([''])

  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'in', label: 'on', port: { id: 'in', type: 'target', required: true } }] }
  ]

  const right: ScenarioNodeCell[] = [
    ...cases.map((value, i): ScenarioNodeCell => {
      const caseId = `case${i + 1}`
      return {
        id: caseId,
        content: (
          <input
            className="scn-case-input nodrag"
            value={value}
            placeholder="value"
            onMouseDown={(e) => { e.stopPropagation() }}
            onChange={(e) => { setCases((cs) => cs.map((c, j) => (j === i ? e.target.value : c))) }}
          />
        ),
        port: { id: caseId, role: 'case', type: 'source' }
      }
    }),
    {
      id: 'add-case',
      content: (
        <Button
          small
          secondary
          icon="add"
          onClick={() => { setCases((cs) => [...cs, '']) }}
          options={{ ariaLabel: 'Add output', title: 'Add output' }}
          data-testid="scenario-switch-add-case"
        />
      )
    },
    { id: 'default', label: 'default', port: { id: 'default', role: 'default', type: 'source' } }
  ]

  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default SwitchNodeBox
