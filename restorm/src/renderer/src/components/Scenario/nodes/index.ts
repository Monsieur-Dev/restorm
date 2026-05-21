import { createElement, type FC } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { ScenarioNodeKind } from '../../../../../shared/types/collections'
import { type ScenarioNodeBoxType } from './ScenarioNodeBoxBase'
import { DefaultNodeBox } from './DefaultNodeBox'
import { IfNodeBox } from './IfNodeBox'
import { RequestNodeBox } from './RequestNodeBox'
import { RunScenarioNodeBox } from './RunScenarioNodeBox'
import { SwitchNodeBox } from './SwitchNodeBox'
import { WaitNodeBox } from './WaitNodeBox'
import { WaitUntilNodeBox } from './WaitUntilNodeBox'
import { ComparatorNodeBox, ArithmeticNodeBox, BooleanNodeBox } from './BinaryOpNodeBox'
import { InputNodeBox, GetVariableNodeBox, SetVariableNodeBox } from './VariableNodeBox'
import { TransformNodeBox, TemplateNodeBox } from './TransformNodeBox'

export type { ScenarioNodeBoxData, ScenarioNodeBoxType, ScenarioNodeCell } from './ScenarioNodeBoxBase'
export { ScenarioNodeBoxBase } from './ScenarioNodeBoxBase'

type NodeBoxComponent = FC<NodeProps<ScenarioNodeBoxType>>

/**
 * Per-kind node box components. Each kind that needs a bespoke body
 * registers its component here; everything else falls back to
 * `DefaultNodeBox`. Add a new file under `nodes/` + one line here.
 */
const SCENARIO_NODE_COMPONENTS: Partial<Record<ScenarioNodeKind, NodeBoxComponent>> = {
  if: IfNodeBox,
  switch: SwitchNodeBox,
  request: RequestNodeBox,
  runScenario: RunScenarioNodeBox,
  wait: WaitNodeBox,
  waitUntil: WaitUntilNodeBox,
  comparator: ComparatorNodeBox,
  arithmetic: ArithmeticNodeBox,
  boolean: BooleanNodeBox,
  input: InputNodeBox,
  getVariable: GetVariableNodeBox,
  setVariable: SetVariableNodeBox,
  transform: TransformNodeBox,
  template: TemplateNodeBox
}

/** The component that renders a given node kind (bespoke or default). */
export function nodeBoxForKind(kind: ScenarioNodeKind): NodeBoxComponent {
  return SCENARIO_NODE_COMPONENTS[kind] ?? DefaultNodeBox
}

/**
 * Single React Flow node type for scenarios — dispatches to the per-kind
 * box component by `data.kind`. Registered as `nodeTypes.scenarioNode`.
 * (Named `…View` to avoid clashing with the `ScenarioNode` data-model type.)
 */
export const ScenarioNodeView: NodeBoxComponent = (props) => {
  const Component = nodeBoxForKind(props.data.kind)
  return createElement(Component, props)
}
