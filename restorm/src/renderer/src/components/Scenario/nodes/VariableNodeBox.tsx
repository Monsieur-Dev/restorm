import React, { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/** Small single-line text field for a node-local name (visual until config schema). */
const NameField: React.FC<{ placeholder: string }> = ({ placeholder }) => {
  const [value, setValue] = useState('')
  return (
    <input
      className="scn-name-input nodrag"
      value={value}
      placeholder={placeholder}
      onMouseDown={(e) => { e.stopPropagation() }}
      onChange={(e) => { setValue(e.target.value) }}
    />
  )
}

const VALUE_OUT: ScenarioNodeCell = { id: 'value', label: 'value', port: { id: 'value', type: 'source' } }

/** `input` — a named scenario parameter; produces `value`. Runnable (no input). */
export const InputNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [{ id: 'main', rows: [{ id: 'name', content: <NameField placeholder="name" /> }] }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[VALUE_OUT]} canPlay />
}

/** `getVariable` — reads a named variable; produces `value`. Runnable (no input). */
export const GetVariableNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [{ id: 'main', rows: [{ id: 'name', content: <NameField placeholder="variable" /> }] }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[VALUE_OUT]} canPlay />
}

/** `setVariable` — stores its (mandatory) input into a named variable, passing it through. */
export const SetVariableNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'name', content: <NameField placeholder="variable" /> },
        { id: 'value', label: 'value', port: { id: 'value', type: 'target', required: true } }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [{ id: 'out', label: 'value', port: { id: 'out', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
