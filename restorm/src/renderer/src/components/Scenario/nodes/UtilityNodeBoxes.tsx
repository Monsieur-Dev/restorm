import React, { useMemo } from 'react'
import { type NodeProps, useNodeConnections } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, RadioGroup, type ISelectOptionItem, type VariableDefinition } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { SegmentedToggle } from './SegmentedToggle'
import { ASSERT_OPS, isAssertUnaryOp, type AssertOp } from '../../../../../shared/scenarioAssert'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { useHandlebarsHelpers } from '../../../hooks/useHandlebarsHelpers'
import { useScenarioStaticPreview } from '../scenarioStaticPreviewContext'
import { useScenarioEdgeSelector } from '../scenarioEdgeSelector'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { resolveSelectorPath, concreteValue, portPreviewValue } from '../../../../../shared/utils/scenarioStaticPreview'
import { StringValue, NullValue } from '../../../../../shared/types/collections'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'

/** One-line preview of a value used as an expression-autocomplete suggestion. */
function shortLogPreview(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.length > 32 ? `"${v.slice(0, 32)}…"` : `"${v}"`
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (Array.isArray(v)) return `[${v.length}]`
  return '{…}'
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
/** The assert message is a plain text label — lock its selector to the `string`
 * kind (no expression / variable / typed alternatives), so it renders a bare
 * text input. It stays connectable: wire an upstream string in instead. */
const STRING_ONLY_EXCLUDE: ValueTypeKind[] = [
  'secret', 'number', 'dateTime', 'color', 'boolean', 'expression', 'variable', 'enum', 'enumList', 'customList', 'customListMulti'
]

/**
 * `log` — records a value at a chosen level during the run; a terminal sink (no
 * output). `level` is a radio toggle; `message` accepts ANY type (an Expression
 * is rendered against the `data` value as its Handlebars context, so `{{name}}`
 * reads `data.name`) and `data` (a connectable value of any type, with the full
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

  // An Expression message renders against `data`, so its autocomplete proposes
  // the Handlebars helpers (Ctrl+Space) + the `data` value's keys — the same
  // editor experience as `transform`. `data` keys come from the wired source's
  // preview (after the edge selector) or the inline `data` config.
  const helpers = useHandlebarsHelpers()
  const staticPreview = useScenarioStaticPreview()
  const edgeSelectorApi = useScenarioEdgeSelector()
  const dataConnections = useNodeConnections({ handleType: 'target', handleId: 'data' })
  const dataSourceId = dataConnections[0]?.source
  const dataSourceHandle = dataConnections[0]?.sourceHandle
  const dataEdgeId = dataConnections[0]?.edgeId
  const dataConfig = config['data']
  const messageVariables = useMemo<VariableDefinition[]>(() => {
    let resolved: unknown
    if (dataSourceId) {
      const preview = staticPreview?.getPreview(dataSourceId) ?? null
      // Wired but the source has no static preview (a runtime-only source, an
      // unresolved variable…): still offer `.` so `{{.}}` is at least suggested.
      if (!preview) return [{ name: '.', value: '' }]
      // Unwrap the source's display wrapper to the value the PORT carries (a
      // `result`-keyed node feeds its bare value), then apply the edge selector.
      const portVal = portPreviewValue(preview, dataSourceHandle ?? '.')
      const selector = dataEdgeId ? edgeSelectorApi?.getSelector(dataEdgeId) : undefined
      resolved = selector !== undefined && selector !== '' && selector !== '.' ? resolveSelectorPath(portVal, selector) : portVal
    } else {
      resolved = concreteValue(dataConfig)
    }
    if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
      return Object.entries(resolved as Record<string, unknown>).map(([name, val]) => ({ name, value: shortLogPreview(val) }))
    }
    return resolved === null || resolved === undefined || resolved === '' ? [] : [{ name: '.', value: shortLogPreview(resolved) }]
  }, [dataSourceId, dataSourceHandle, dataEdgeId, staticPreview, edgeSelectorApi, dataConfig])

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
            <div className="nodrag scn-stacked-field scn-template-field" onMouseDown={(e) => { e.stopPropagation() }}>
              <span className="scn-port-label">{t('scenario.log.message', 'message')}</span>
              <TypedValueField
                value={config['message'] !== undefined ? normalizeValueType(config['message']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { message: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_VALUE_EXCLUDE}
                allowAllVariables
                allowEnvironment
                variables={messageVariables}
                helpers={helpers}
                expressionVariableId={`scn-log-message-${id}`}
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
            <div className="nodrag scn-stacked-field scn-log-data-field" onMouseDown={(e) => { e.stopPropagation() }}>
              <span className="scn-port-label">{t('scenario.log.data', 'data')}</span>
              <TypedValueField
                value={config['data'] !== undefined ? normalizeValueType(config['data']) : new NullValue()}
                onChange={(next) => { data.onSetConfig?.(id, { data: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={['expression']}
                allowAllVariables
                allowEnvironment
                allowNull
                allowList
                dataTestId="scn-log-data"
              />
            </div>
          )
        }
      ]
    }
  ]
  // Terminal sink: a header launch trigger (`in`) so it can be sequenced, but
  // no output (no passthrough, and logging can't fail, so no error port either).
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} />
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
  const assertOp: AssertOp = typeof rawOp === 'string' && (ASSERT_OPS as readonly string[]).includes(rawOp) ? (rawOp as AssertOp) : 'eq'

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
          allowNull
          allowList
          dataTestId={`scn-assert-${key}`}
        />
      </div>
    )
  })

  const rows: ScenarioNodeCell[] = [
    operand('a', 'actual'),
    {
      id: 'operator',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.assert.operator', 'operator')}</div>
          <SelectBox
            id={`scn-assert-op-${id}`}
            className=""
            options={ASSERT_OPS.map((o) => ({ text: o, label: t(`scenario.assert.op.${o}`, o) }))}
            selected={Math.max(0, ASSERT_OPS.indexOf(assertOp))}
            onDidSelect={({ selected }) => { data.onSetConfig?.(id, { operator: selected }) }}
            data-testid="scn-assert-op"
          />
        </div>
      )
    }
  ]
  // The unary operators (type checks, exists, isEmpty…) read only `actual` —
  // hide the `expected` operand for them.
  if (!isAssertUnaryOp(assertOp)) rows.push(operand('b', 'expected'))
  rows.push({
    id: 'message',
    port: { id: 'message', type: 'target' },
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
  })
  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'then', label: 'pass', port: { id: 'then', role: 'then', type: 'source' } },
    { id: 'else', label: 'fail', port: { id: 'else', role: 'else', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/** Output formats the `now` box can emit. The runtime + static preview both
 * branch on this — `datetime` returns a real Date so Handlebars date helpers
 * (`formatDate`, `year`, …) can operate on it, `epoch` is a number suitable
 * for arithmetic, `string` is the ISO/timezone-formatted text. */
export const NOW_FORMATS = ['datetime', 'epoch', 'string'] as const
export type NowFormat = (typeof NOW_FORMATS)[number]

/** The system's IANA timezone — the sensible default when the box's config
 * doesn't pin one. */
function localTimezone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Every IANA timezone the host runtime knows about (Node + modern Chromium
 * both expose `Intl.supportedValuesOf('timeZone')`). Computed once. */
const ALL_TIMEZONES: readonly string[] = (() => {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (typeof sv === 'function') return sv('timeZone')
  } catch {
    /* fall through */
  }
  return ['UTC', 'Europe/Paris', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo']
})()

/** The current UTC offset for an IANA timezone, formatted as `UTC+02:00` —
 * shown next to each option so the user knows the wall-clock shift at a
 * glance. DST-aware (uses today's date). */
function timezoneOffsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date())
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    return tzName.replace(/^GMT/, 'UTC') || 'UTC+00:00'
  } catch {
    return ''
  }
}

/** SelectBox options for every IANA zone, labelled with their current UTC
 * offset. Memoised to a module-level array so a re-render doesn't recompute
 * 400+ Intl.DateTimeFormat instances. */
const TZ_SELECT_OPTIONS: ISelectOptionItem[] = ALL_TIMEZONES.map((tz) => {
  const offset = timezoneOffsetLabel(tz)
  return { text: tz, label: offset ? `${tz} (${offset})` : tz }
})

/** `now` — emit the current time. An *optional* launch trigger (header input)
 * lets it recompute when fired (e.g. after a request returns a timestamp)
 * instead of only once at start; runnable on its own otherwise. Two config
 * fields shape the output: a `timezone` (IANA, e.g. `Europe/Paris`, or
 * `UTC` / `local`) and a `format` radio (Date object / epoch ms / string).
 * It can't fail, so no error port. */
export const NowNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const timezone = typeof config['timezone'] === 'string' && config['timezone'] !== '' ? config['timezone'] : localTimezone()
  const tzIndex = Math.max(0, ALL_TIMEZONES.indexOf(timezone))
  const rawFormat = config['format']
  const format: NowFormat = typeof rawFormat === 'string' && (NOW_FORMATS as readonly string[]).includes(rawFormat) ? rawFormat as NowFormat : 'datetime'
  const formatLabels: Record<NowFormat, string> = {
    datetime: t('scenario.now.format.datetime', 'DateTime'),
    epoch: t('scenario.now.format.epoch', 'Epoch'),
    string: t('scenario.now.format.string', 'String')
  }
  const radioItems = { items: NOW_FORMATS.map((f) => ({ text: formatLabels[f], isActive: format === f })) }
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'timezone',
          label: t('scenario.now.timezone', 'timezone'),
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <SelectBox
                id={`scn-now-tz-${id}`}
                className="scn-now-timezone"
                options={TZ_SELECT_OPTIONS}
                selected={tzIndex}
                onDidSelect={({ selected }) => { data.onSetConfig?.(id, { timezone: selected }) }}
                data-testid="scn-now-timezone"
              />
            </div>
          )
        },
        {
          id: 'format',
          label: t('scenario.now.formatLabel', 'format'),
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <RadioGroup
                options={radioItems}
                onSelect={(idx) => { const next = NOW_FORMATS[idx]; if (next) data.onSetConfig?.(id, { format: next }) }}
                data-testid="scn-now-format"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [{ id: 'value', label: 'now', port: { id: 'value', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
