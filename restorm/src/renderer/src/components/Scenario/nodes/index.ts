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
import { ComparatorNodeBox } from './ComparatorNodeBox'
import { BooleanNodeBox } from './BooleanNodeBox'
import { ArithmeticNodeBox } from './ArithmeticNodeBox'
import { InputNodeBox, OutputNodeBox, GetVariableNodeBox, SetVariableNodeBox } from './VariableNodeBox'
import { TransformNodeBox } from './TransformNodeBox'
import { ForEachNodeBox } from './ForEachNodeBox'
import { AggregateNodeBox } from './AggregateNodeBox'
import { FilterNodeBox } from './FilterNodeBox'
import { MapNodeBox } from './MapNodeBox'
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
  output: OutputNodeBox,
  if: IfNodeBox,
  switch: SwitchNodeBox,
  httpRequest: RequestNodeBox,
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
/**
 * Inert placeholder for a persisted node whose kind this build no longer knows
 * — a renamed or removed kind, or a scenario authored by a newer version. The
 * `Record` above is exhaustive for current kinds, but on-disk data can outlive
 * a rename, so render a harmless box instead of crashing the whole editor.
 */
const UnknownNodeBox: NodeBoxComponent = (props) =>
  createElement(
    'div',
    { className: 'scn-node scn-node-unknown', 'data-testid': 'scn-node-unknown' },
    createElement('div', { className: 'scn-node-header' }, `Unknown node: ${props.data.kind}`)
  )

export const ScenarioNodeView: NodeBoxComponent = (props) => {
  // The map is exhaustive over known kinds at the type level, but on-disk data
  // can carry a kind this build no longer knows — so treat the lookup as
  // possibly-undefined and fall back to the inert placeholder.
  const Component = SCENARIO_NODE_COMPONENTS[props.data.kind] as NodeBoxComponent | undefined
  return createElement(Component ?? UnknownNodeBox, props)
}
