import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { OperatorToggle, OPERATOR_OPTIONS, type OperatorOption } from './OperatorToggle'
import { buildParallelismCell } from './parallelismCell'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'

/**
 * `for` — a numeric-range iteration: `from` / `to` / `step` (each a typed-value
 * selector when unwired, swapped for the JSON-path selector once a data link is
 * connected) drive the range. Emits the current number on `each`, then `done`
 * when every iteration's scope has closed. The parallelism row (shared with
 * `forEach`) configures bounded concurrent iteration.
 */
/** A `for` range bound is a number — every other value-type kind is hidden
 * from the selector (looping over strings / dates / enums makes no sense). */
const NON_NUMERIC_VALUE_TYPES: ValueTypeKind[] = ['string', 'secret', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'variable', 'environment']

export const ForNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}

  const bound = (key: 'from' | 'to' | 'step', label: string): ScenarioNodeCell => ({
    id: key,
    label,
    port: { id: key, type: 'target' },
    // A caption labels each field (from / to / step) — a cell's `content`
    // overrides its `label`, so the name is shown inline like the other nodes.
    // The selector is bounded to NUMBERS (a range over strings makes no sense);
    // a dynamic bound is wired into the port instead. Defaults to numeric 0.
    content: (
      <div className="nodrag scn-stacked-field" onMouseDown={(e) => { e.stopPropagation() }}>
        <span className="scn-port-label">{label}</span>
        <TypedValueField
          value={normalizeValueType(config[key] ?? { type: 'numeric', value: key === 'step' ? 1 : 0 })}
          onChange={(next) => { data.onSetConfig?.(id, { [key]: serializeValueForPersistence(next) }) }}
          excludeTypes={NON_NUMERIC_VALUE_TYPES}
          dataTestId={`scn-for-${key}`}
        />
      </div>
    )
  })

  // The loop-condition operator (`index <op> to`) — user-selectable like the
  // `if` operator, defaulting to `<`. Sits between the `from` start and the
  // `to` bound.
  const rawOp = config['operator']
  const operator: OperatorOption = typeof rawOp === 'string' && (OPERATOR_OPTIONS as readonly string[]).includes(rawOp) ? (rawOp as OperatorOption) : '<'
  const left: ScenarioNodeSection[] = [{
    id: 'main',
    rows: [
      bound('from', t('scenario.for.from', 'from')),
      {
        id: 'operator',
        content: (
          <OperatorToggle
            value={operator}
            onChange={(op) => { data.onSetConfig?.(id, { operator: op }) }}
          />
        )
      },
      bound('to', t('scenario.for.to', 'to')),
      bound('step', t('scenario.for.step', 'step'))
    ]
  }]
  const right: ScenarioNodeCell[] = [
    { id: 'each', label: t('scenario.for.index', 'index'), port: { id: 'each', role: 'then', type: 'source' } },
    // Loop completion is the universal `Done` port (drawn by the box base).
    buildParallelismCell({ id, config, onSetConfig: data.onSetConfig, label: t('scenario.forEach.parallelism', 'parallelism'), testIdPrefix: 'scn-for' })
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/**
 * Shared renderer for the condition loops `while` / `doWhile`. They ARE the
 * `if` mechanism (two operands compared by the operator toggle), routing the
 * trigger to the body output (`then`) while the condition holds and to `done`
 * (`else`) when it fails. The loop is closed by a user-wired edge from the body
 * back into the header trigger (or an operand). `while` tests at the top of the
 * loop; `doWhile` is wired after the body so it runs at least once — only the
 * body-output label differs to hint the wiring.
 */
const ConditionLoopNodeBox: React.FC<NodeProps<ScenarioNodeBoxType> & { bodyLabel: string; testId: string }> = ({ id, data, selected, bodyLabel, testId }) => {
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const operand = (key: 'left' | 'right'): ScenarioNodeCell => ({
    id: key,
    label: key,
    port: { id: key, type: 'target' },
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <TypedValueField
          value={normalizeValueType(config[key])}
          onChange={(next) => { data.onSetConfig?.(id, { [key]: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={['expression']}
          allowEnvironment
          dataTestId={`${testId}-${key}`}
        />
      </div>
    )
  })

  const rawOp = config['operator']
  const operator: OperatorOption | undefined =
    typeof rawOp === 'string' && (OPERATOR_OPTIONS as readonly string[]).includes(rawOp) ? (rawOp as OperatorOption) : undefined

  const left: ScenarioNodeSection[] = [{
    id: 'main',
    rows: [
      operand('left'),
      {
        id: 'operator',
        content: (
          <OperatorToggle
            {...(operator !== undefined ? { value: operator } : {})}
            onChange={(op) => { data.onSetConfig?.(id, { operator: op }) }}
          />
        )
      },
      operand('right')
    ]
  }]
  const right: ScenarioNodeCell[] = [
    // Body is a pure SIGNAL (fires the body each pass; no per-iteration value).
    { id: 'then', label: bodyLabel, port: { id: 'then', role: 'then', type: 'source', flow: 'signal' } }
    // Loop exit / completion is the universal `Done` port (drawn by the box base).
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/** `while` — condition tested at the top of the loop (body output: "body"). */
export const WhileNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = (props) => {
  const { t } = useTranslation()
  return <ConditionLoopNodeBox {...props} bodyLabel={t('scenario.while.body', 'body')} testId="scn-while" />
}

/** `doWhile` — wired after the body so it runs once first (body output: "loop"). */
export const DoWhileNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = (props) => {
  const { t } = useTranslation()
  return <ConditionLoopNodeBox {...props} bodyLabel={t('scenario.doWhile.loop', 'loop')} testId="scn-dowhile" />
}
