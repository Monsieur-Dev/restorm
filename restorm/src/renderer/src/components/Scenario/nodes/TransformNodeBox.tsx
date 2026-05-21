import React, { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/** Multi-line code/expression field (visual until config schema). */
const CodeField: React.FC<{ placeholder: string }> = ({ placeholder }) => {
  const [value, setValue] = useState('')
  return (
    <textarea
      className="scn-code-input nodrag"
      rows={2}
      value={value}
      placeholder={placeholder}
      onMouseDown={(e) => { e.stopPropagation() }}
      onChange={(e) => { setValue(e.target.value) }}
    />
  )
}

/** `transform` — applies an expression to its (mandatory) input value. */
export const TransformNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'value', label: 'value', port: { id: 'value', type: 'target', required: true } },
        { id: 'expr', content: <CodeField placeholder="expression" /> }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [{ id: 'out', label: 'value', port: { id: 'out', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/** `template` — renders a text template; `vars` input is optional, so it can run on its own. */
export const TemplateNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'vars', label: 'vars', port: { id: 'vars', type: 'target' } },
        { id: 'tpl', content: <CodeField placeholder="template" /> }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [{ id: 'text', label: 'text', port: { id: 'text', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} canPlay />
}
