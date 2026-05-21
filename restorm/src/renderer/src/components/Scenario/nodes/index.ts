import { createElement, type FC } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { ScenarioNodeKind } from '../../../../../shared/types/collections'
import { type ScenarioNodeBoxType } from './ScenarioNodeBoxBase'
import { IfNodeBox } from './IfNodeBox'
import { RequestNodeBox } from './RequestNodeBox'
import { RunScenarioNodeBox } from './RunScenarioNodeBox'
import { SwitchNodeBox } from './SwitchNodeBox'
import { WaitNodeBox } from './WaitNodeBox'
import { WaitUntilNodeBox } from './WaitUntilNodeBox'
import { ComparatorNodeBox, ArithmeticNodeBox, BooleanNodeBox } from './BinaryOpNodeBox'
import { InputNodeBox, GetVariableNodeBox, SetVariableNodeBox } from './VariableNodeBox'
import { TransformNodeBox, TemplateNodeBox } from './TransformNodeBox'
import { ForEachNodeBox, AggregateNodeBox, MapNodeBox, FilterNodeBox } from './CollectionNodeBoxes'
import { LogNodeBox, AssertNodeBox, NowNodeBox } from './UtilityNodeBoxes'

export type { ScenarioNodeBoxData, ScenarioNodeBoxType, ScenarioNodeCell } from './ScenarioNodeBoxBase'
export { ScenarioNodeBoxBase } from './ScenarioNodeBoxBase'

type NodeBoxComponent = FC<NodeProps<ScenarioNodeBoxType>>

/**
 * Per-kind node box components — one bespoke component for every kind, no
 * generic fallback. The full `Record` makes TypeScript reject adding a new
 * `ScenarioNodeKind` without registering a component for it. Add a new file
 * under `nodes/` + one line here.
 */
const SCENARIO_NODE_COMPONENTS: Record<ScenarioNodeKind, NodeBoxComponent> = {
  input: InputNodeBox,
  if: IfNodeBox,
  switch: SwitchNodeBox,
  request: RequestNodeBox,
  runScenario: RunScenarioNodeBox,
  forEach: ForEachNodeBox,
  aggregate: AggregateNodeBox,
  map: MapNodeBox,
  filter: FilterNodeBox,
  wait: WaitNodeBox,
  waitUntil: WaitUntilNodeBox,
  now: NowNodeBox,
  arithmetic: ArithmeticNodeBox,
  comparator: ComparatorNodeBox,
  boolean: BooleanNodeBox,
  template: TemplateNodeBox,
  setVariable: SetVariableNodeBox,
  getVariable: GetVariableNodeBox,
  transform: TransformNodeBox,
  log: LogNodeBox,
  assert: AssertNodeBox
}

/** The bespoke component that renders a given node kind. */
export function nodeBoxForKind(kind: ScenarioNodeKind): NodeBoxComponent {
  return SCENARIO_NODE_COMPONENTS[kind]
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
