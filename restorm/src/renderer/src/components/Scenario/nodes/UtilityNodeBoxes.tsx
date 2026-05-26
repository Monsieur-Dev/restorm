import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { SegmentedToggle } from './SegmentedToggle'
import { OperatorToggle, OPERATOR_OPTIONS, type OperatorOption } from './OperatorToggle'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
/** The message is a plain text label — lock its selector to the `string` kind
 * (no expression / variable / typed alternatives), so it renders a bare text
 * input. It stays connectable: wire an upstream string in instead of typing. */
const STRING_ONLY_EXCLUDE: ValueTypeKind[] = [
  'secret', 'number', 'dateTime', 'color', 'boolean', 'expression', 'variable', 'enum', 'enumList', 'customList', 'customListMulti'
]

/**
 * `log` — records a value at a chosen level during the run; a terminal sink (no
 * output). `level` is a radio toggle; `message` (a connectable string, locked to
 * the string kind) and `data` (a connectable value of any type, with the full
 * variable picker) are both optional — wire either, or set it inline.
 * {@link ScenarioInputCell} swaps an input for the JSON-path selector when a
 * data link is wired. Level + message + data persist in config.
 */
export const LogNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const rawLevel = config['level']
  const level = typeof rawLevel === 'string' && (LOG_LEVELS as readonly string[]).includes(rawLevel) ? rawLevel : 'info'

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'level',
          content: <SegmentedToggle options={LOG_LEVELS} value={level} onChange={(l) => { data.onSetConfig?.(id, { level: l }) }} ariaLabel="level" />
        },
        {
          id: 'message',
          label: t('scenario.log.message', 'message'),
          port: { id: 'message', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <div className="scn-field-caption">{t('scenario.log.message', 'message')}</div>
              <TypedValueField
                value={config['message'] !== undefined ? normalizeValueType(config['message']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { message: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_ONLY_EXCLUDE}
                dataTestId="scn-log-message"
              />
            </div>
          )
        },
        {
          id: 'data',
          label: t('scenario.log.data', 'data'),
          port: { id: 'data', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <div className="scn-field-caption">{t('scenario.log.data', 'data')}</div>
              <TypedValueField
                value={normalizeValueType(config['data'])}
                onChange={(next) => { data.onSetConfig?.(id, { data: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                allowAllVariables
                dataTestId="scn-log-data"
              />
            </div>
          )
        }
      ]
    }
  ]
  // Terminal sink: no output at all (no passthrough, and logging can't fail, so
  // no error port either).
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} hasError={false} />
}

/**
 * `assert` — compares two operands (`actual` / `expected`) with the same
 * operator toggle as `if`/`comparator` (< ≤ = ≥ > ≠ ∋) and branches `pass` /
 * `fail`. Each operand is a typed-value selector when unwired (so the assertion
 * is authorable without links); {@link ScenarioInputCell} swaps it for the
 * JSON-path selector once a data link is connected. The optional `message` is
 * the assertion's label, surfaced in the run report when it fails — that's what
 * makes a `fail` a *named* test failure rather than a plain `if` branch.
 * Operands + operator + message persist in config; a header trigger sequences
 * it like an `if`.
 */
export const AssertNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const rawOp = config['operator']
  const operator: OperatorOption | undefined =
    typeof rawOp === 'string' && (OPERATOR_OPTIONS as readonly string[]).includes(rawOp) ? (rawOp as OperatorOption) : undefined

  const operand = (key: 'a' | 'b', label: string): ScenarioNodeCell => ({
    id: key,
    label,
    port: { id: key, type: 'target' },
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <TypedValueField
          value={normalizeValueType(config[key])}
          onChange={(next) => { data.onSetConfig?.(id, { [key]: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={['expression']}
          allowEnvironment
          dataTestId={`scn-assert-${key}`}
        />
      </div>
    )
  })

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        operand('a', 'actual'),
        {
          id: 'operator',
          content: (
            <OperatorToggle
              {...(operator !== undefined ? { value: operator } : {})}
              onChange={(op) => { data.onSetConfig?.(id, { operator: op }) }}
            />
          )
        },
        operand('b', 'expected'),
        {
          id: 'message',
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <div className="scn-field-caption">{t('scenario.assert.message', 'message')}</div>
              <TypedValueField
                value={config['message'] !== undefined ? normalizeValueType(config['message']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { message: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_ONLY_EXCLUDE}
                dataTestId="scn-assert-message"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'then', label: 'pass', port: { id: 'then', role: 'then', type: 'source' } },
    { id: 'else', label: 'fail', port: { id: 'else', role: 'else', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} launchInput />
}

/** `now` — emit the current time. An *optional* launch trigger (header input)
 * lets it recompute when fired (e.g. after a request returns a timestamp)
 * instead of only once at start; runnable on its own otherwise. It can't fail,
 * so no error port. */
export const NowNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const right: ScenarioNodeCell[] = [{ id: 'value', label: 'now', port: { id: 'value', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={[]} right={right} launchInput canPlay hasError={false} />
}
