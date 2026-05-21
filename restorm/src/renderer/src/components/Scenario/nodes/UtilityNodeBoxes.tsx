import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/** `log` — record its (mandatory) input value, then continue. */
export const LogNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [{ id: 'main', rows: [{ id: 'value', label: 'value', port: { id: 'value', type: 'target', required: true } }] }]
  const right: ScenarioNodeCell[] = [{ id: 'out', label: 'out', port: { id: 'out', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/** `assert` — branch `pass` / `fail` on its (mandatory) input. */
export const AssertNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [{ id: 'main', rows: [{ id: 'value', label: 'value', port: { id: 'value', type: 'target', required: true } }] }]
  const right: ScenarioNodeCell[] = [
    { id: 'then', label: 'pass', port: { id: 'then', role: 'then', type: 'source' } },
    { id: 'else', label: 'fail', port: { id: 'else', role: 'else', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/** `now` — emit the current time. An *optional* launch trigger (header input)
 * lets it recompute when fired (e.g. after a request returns a timestamp)
 * instead of only once at start; runnable on its own otherwise. It can't fail,
 * so no error port. */
export const NowNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const right: ScenarioNodeCell[] = [{ id: 'value', label: 'now', port: { id: 'value', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={[]} right={right} launchInput canPlay hasError={false} />
}
