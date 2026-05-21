import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/** A single mandatory `items` input — shared by the collection nodes. */
function itemsInput(): ScenarioNodeSection[] {
  return [{ id: 'main', rows: [{ id: 'items', label: 'items', port: { id: 'items', type: 'target', required: true } }] }]
}

/** `forEach` — iterate a collection: emits each item, then `done`. */
export const ForEachNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const right: ScenarioNodeCell[] = [
    { id: 'each', label: 'each', port: { id: 'each', role: 'then', type: 'source' } },
    { id: 'done', label: 'done', port: { id: 'done', role: 'else', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={itemsInput()} right={right} />
}

/** `aggregate` — reduce a collection to a single `result`. */
export const AggregateNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const right: ScenarioNodeCell[] = [{ id: 'result', label: 'result', port: { id: 'result', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={itemsInput()} right={right} />
}

/** `map` — transform each item into a new collection. */
export const MapNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const right: ScenarioNodeCell[] = [{ id: 'mapped', label: 'mapped', port: { id: 'mapped', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={itemsInput()} right={right} />
}

/** `filter` — keep the items matching a predicate. */
export const FilterNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const right: ScenarioNodeCell[] = [{ id: 'kept', label: 'kept', port: { id: 'kept', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={itemsInput()} right={right} />
}
