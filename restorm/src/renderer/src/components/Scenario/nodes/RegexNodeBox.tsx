import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, Toggle, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { HeaderHoverTooltip } from '../../MainView/HeaderHoverTooltip'
import { TypedValueField } from '../../TypedValueField'
import { useScenarioFieldInvalid } from '../scenarioErrorsContext'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { REGEX_OPS, isRegexOp, type RegexOp } from '../../../../../shared/scenarioRegex'

/** A regex runs over a STRING, so the operand only offers string-ish types
 * (string / number coerced / variable / expression / secret / enum). Booleans,
 * dates, colours and lists make no sense as a regex target and are excluded. */
const REGEX_NON_STRING_TYPES: ValueTypeKind[] = ['boolean', 'dateTime', 'color', 'list', 'enumList', 'customListMulti', 'null']

/** The regex flag switches. `g` is omitted — it's implied per-operation
 * (extractAll / replace are always global). Each is an independent toggle. */
const REGEX_FLAGS = ['i', 'm', 's'] as const

/**
 * `regex` — runs a regular-expression operation over its `value` string. The
 * operation picker (extract / extractAll / test / replace / split) drives which
 * extra fields show: `pattern` + `flags` always, plus a `replacement` for the
 * `replace` op. The `value` operand is a typed-value selector (wire a link, or
 * set it inline). An invalid pattern surfaces on the implicit `error` port. Op +
 * pattern + flags + replacement + value persist in the node config.
 */
export const RegexNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: RegexOp = isRegexOp(config['op']) ? config['op'] : 'extract'
  const pattern = typeof config['pattern'] === 'string' ? config['pattern'] : ''
  const flags = typeof config['flags'] === 'string' ? config['flags'] : ''
  const replacement = typeof config['replacement'] === 'string' ? config['replacement'] : ''
  const patternInvalid = useScenarioFieldInvalid(id, 'pattern')

  const opOptions = REGEX_OPS.map((o) => ({ text: o, label: t(`scenario.regex.op.${o}`, o) }))

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.regex.value', 'value'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={REGEX_NON_STRING_TYPES}
            allowAllVariables
            dataTestId={`scn-regex-value-${id}`}
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.regex.operation', 'operation')}</div>
          <SelectBox
            id={`scn-regex-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, REGEX_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = REGEX_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-regex-op"
          />
        </div>
      )
    },
    {
      id: 'pattern',
      port: { id: 'pattern', type: 'target' },
      content: (
        <div className={`nodrag${patternInvalid ? ' scn-field-invalid' : ''}`} onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.regex.pattern', 'pattern')}</div>
          <InputBox
            value={pattern}
            onChange={(next) => { data.onSetConfig?.(id, { pattern: next }) }}
            options={{ type: 'text', placeholder: '\\d+' }}
            data-testid="scn-regex-pattern"
          />
        </div>
      )
    },
    {
      id: 'flags',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.regex.flags', 'flags')}</div>
          <div className="scn-log-toggle-actions scn-regex-flags">
            {REGEX_FLAGS.map((f) => (
              <HeaderHoverTooltip key={f} label={t(`scenario.regex.flag.${f}`, f)}>
                <Toggle
                  appearance="button"
                  checked={flags.includes(f)}
                  onChange={(checked) => { data.onSetConfig?.(id, { flags: checked ? (flags.includes(f) ? flags : flags + f) : flags.replace(f, '') }) }}
                  data-testid={`scn-regex-flag-${f}`}
                  aria-label={t(`scenario.regex.flag.${f}`, f)}
                >
                  {f}
                </Toggle>
              </HeaderHoverTooltip>
            ))}
          </div>
        </div>
      )
    }
  ]

  if (op === 'replace') {
    rows.push({
      id: 'replacement',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.regex.replacement', 'replacement')}</div>
          <InputBox
            value={replacement}
            onChange={(next) => { data.onSetConfig?.(id, { replacement: next }) }}
            options={{ type: 'text', placeholder: '$1' }}
            data-testid="scn-regex-replacement"
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.regex.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default RegexNodeBox
