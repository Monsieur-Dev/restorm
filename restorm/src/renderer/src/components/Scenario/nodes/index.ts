import { createElement, memo, type FC } from 'react'
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
import { ObjectNodeBox } from './ObjectNodeBox'
import { ArithmeticNodeBox } from './ArithmeticNodeBox'
import { InputNodeBox, OutputNodeBox, GetVariableNodeBox, SetVariableNodeBox } from './VariableNodeBox'
import { TransformNodeBox } from './TransformNodeBox'
import { CastNodeBox } from './CastNodeBox'
import { RegexNodeBox } from './RegexNodeBox'
import { JsonNodeBox } from './JsonNodeBox'
import { XmlNodeBox } from './XmlNodeBox'
import { YamlNodeBox } from './YamlNodeBox'
import { CryptoNodeBox } from './CryptoNodeBox'
import { JwtNodeBox } from './JwtNodeBox'
import { DateTimeNodeBox } from './DateTimeNodeBox'
import { ObjectOpNodeBox } from './ObjectOpNodeBox'
import { UrlNodeBox } from './UrlNodeBox'
import { RandomNodeBox } from './RandomNodeBox'
import { ListOpNodeBox } from './ListOpNodeBox'
import { CsvNodeBox } from './CsvNodeBox'
import { MathNodeBox } from './MathNodeBox'
import { ThrowNodeBox } from './ThrowNodeBox'
import { RetryNodeBox } from './RetryNodeBox'
import { ForEachNodeBox } from './ForEachNodeBox'
import { ForNodeBox, WhileNodeBox, DoWhileNodeBox } from './LoopNodeBoxes'
import { AggregateNodeBox } from './AggregateNodeBox'
import { FilterNodeBox } from './FilterNodeBox'
import { MapNodeBox } from './MapNodeBox'
import { ListMutationNodeBox } from './ListMutationNodeBox'
import { LogNodeBox, AssertNodeBox, NowNodeBox } from './UtilityNodeBoxes'
import { ToastNodeBox } from './ToastNodeBox'
import { SchemaNodeBox, ReadFileNodeBox, WriteFileNodeBox } from './IoNodeBoxes'
import { TimerNodeBox } from './TimerNodeBox'
import { CodeNodeBox } from './CodeNodeBox'
import { SocketioConnectNodeBox, SocketioSendNodeBox, SocketioCloseNodeBox } from './SocketioNodeBoxes'
import { WebsocketConnectNodeBox, WebsocketSendNodeBox, WebsocketCloseNodeBox } from './WebsocketNodeBoxes'
import { SseConnectNodeBox, SseCloseNodeBox } from './SseNodeBoxes'
import { MqttConnectNodeBox, MqttSendNodeBox, MqttCloseNodeBox } from './MqttNodeBoxes'
import { AmqpConnectNodeBox, AmqpPublishNodeBox, AmqpCloseNodeBox } from './AmqpNodeBoxes'
import { RedisSubscribeNodeBox, RedisCloseNodeBox } from './RedisNodeBoxes'
import { GrpcConnectNodeBox, GrpcSendNodeBox, GrpcCloseNodeBox } from './GrpcNodeBoxes'
import { HttpListenNodeBox, HttpCloseNodeBox } from './HttpServerNodeBoxes'
import { GrpcListenNodeBox, GrpcServerCloseNodeBox } from './GrpcServerNodeBoxes'
import { SoapListenNodeBox, SoapCloseNodeBox } from './SoapServerNodeBoxes'
import { GraphqlListenNodeBox, GraphqlCloseNodeBox } from './GraphqlServerNodeBoxes'
import { ODataListenNodeBox, ODataCloseNodeBox } from './ODataServerNodeBoxes'
import { GraphqlSubscribeNodeBox, GraphqlUnsubscribeNodeBox } from './GraphqlSubscriptionNodeBoxes'

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
  // SOAP is a unary request, so it reuses the protocol-agnostic request box
  // (header badge + collapsible slots + a single `response` output), exactly
  // like httpRequest — no bespoke box needed.
  soapRequest: RequestNodeBox,
  // Redis command mode is unary too (one command → one reply, then
  // disconnect) — same protocol-agnostic request box.
  redisCommand: RequestNodeBox,
  runScenario: RunScenarioNodeBox,
  websocketConnect: WebsocketConnectNodeBox,
  websocketSend: WebsocketSendNodeBox,
  websocketClose: WebsocketCloseNodeBox,
  sseConnect: SseConnectNodeBox,
  sseClose: SseCloseNodeBox,
  mqttConnect: MqttConnectNodeBox,
  mqttSend: MqttSendNodeBox,
  mqttClose: MqttCloseNodeBox,
  amqpConnect: AmqpConnectNodeBox,
  amqpPublish: AmqpPublishNodeBox,
  amqpClose: AmqpCloseNodeBox,
  redisSubscribe: RedisSubscribeNodeBox,
  redisClose: RedisCloseNodeBox,
  grpcConnect: GrpcConnectNodeBox,
  grpcSend: GrpcSendNodeBox,
  grpcClose: GrpcCloseNodeBox,
  httpListen: HttpListenNodeBox,
  httpClose: HttpCloseNodeBox,
  grpcListen: GrpcListenNodeBox,
  grpcServerClose: GrpcServerCloseNodeBox,
  soapListen: SoapListenNodeBox,
  soapClose: SoapCloseNodeBox,
  graphqlListen: GraphqlListenNodeBox,
  graphqlClose: GraphqlCloseNodeBox,
  odataListen: ODataListenNodeBox,
  odataClose: ODataCloseNodeBox,
  graphqlSubscribe: GraphqlSubscribeNodeBox,
  graphqlUnsubscribe: GraphqlUnsubscribeNodeBox,
  socketioConnect: SocketioConnectNodeBox,
  socketioSend: SocketioSendNodeBox,
  socketioClose: SocketioCloseNodeBox,
  forEach: ForEachNodeBox,
  for: ForNodeBox,
  while: WhileNodeBox,
  doWhile: DoWhileNodeBox,
  aggregate: AggregateNodeBox,
  map: MapNodeBox,
  filter: FilterNodeBox,
  addToList: ListMutationNodeBox,
  removeFromList: ListMutationNodeBox,
  wait: WaitNodeBox,
  waitUntil: WaitUntilNodeBox,
  now: NowNodeBox,
  timer: TimerNodeBox,
  arithmetic: ArithmeticNodeBox,
  comparator: ComparatorNodeBox,
  boolean: BooleanNodeBox,
  object: ObjectNodeBox,
  setVariable: SetVariableNodeBox,
  getVariable: GetVariableNodeBox,
  transform: TransformNodeBox,
  code: CodeNodeBox,
  cast: CastNodeBox,
  regex: RegexNodeBox,
  json: JsonNodeBox,
  xml: XmlNodeBox,
  yaml: YamlNodeBox,
  crypto: CryptoNodeBox,
  jwt: JwtNodeBox,
  datetime: DateTimeNodeBox,
  objectOp: ObjectOpNodeBox,
  url: UrlNodeBox,
  random: RandomNodeBox,
  listOp: ListOpNodeBox,
  csv: CsvNodeBox,
  math: MathNodeBox,
  schema: SchemaNodeBox,
  readFile: ReadFileNodeBox,
  writeFile: WriteFileNodeBox,
  throw: ThrowNodeBox,
  retry: RetryNodeBox,
  log: LogNodeBox,
  toast: ToastNodeBox,
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

// `memo` with a custom compare: a scenario box only renders from `id`, `data`
// and `selected` — never its position. React Flow re-renders the dragged node's
// component on every pointer move (new `positionAbsoluteX/Y`, `dragging`), but
// the box CONTENT is position-independent (React Flow moves it via the wrapper
// transform). Skipping those prop changes means dragging a box re-renders no box
// at all — the move is pure CSS transform. Only a real data/selection change
// re-renders the box.
const ScenarioNodeViewInner: NodeBoxComponent = (props) => {
  // The map is exhaustive over known kinds at the type level, but on-disk data
  // can carry a kind this build no longer knows — so treat the lookup as
  // possibly-undefined and fall back to the inert placeholder.
  // `Partial` view on purpose: the map is exhaustive over known kinds at the
  // type level, but on-disk data can carry a kind this build dropped — so the
  // lookup is genuinely possibly-undefined, and the fallback is real.
  const Component = (SCENARIO_NODE_COMPONENTS as Partial<Record<ScenarioNodeKind, NodeBoxComponent>>)[props.data.kind]
  return createElement(Component ?? UnknownNodeBox, props)
}
export const ScenarioNodeView: NodeBoxComponent = memo(
  ScenarioNodeViewInner,
  (prev, next) => prev.id === next.id && prev.data === next.data && prev.selected === next.selected
)
