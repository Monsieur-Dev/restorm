import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioCodeField } from './ScenarioCodeField'
import { SegmentedToggle } from './SegmentedToggle'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'

/** `path` / non-string-y operands are string-only here. */
const NON_STRING_TYPES: ValueTypeKind[] = ['boolean', 'dateTime', 'color', 'list', 'enumList', 'customListMulti', 'null', 'number']

const WRITE_MODES = ['replace', 'append'] as const

/**
 * `schema` — validates `value` against a JSON Schema (ajv). The schema is a
 * multiline JSON string; it routes the value to `valid` / `invalid` and emits
 * the error list on `errors`.
 *
 * The schema field shows a read-only preview + a button opening a full-screen
 * ECUI CodeEditor (JSON) — a JSON Schema rarely fits the cramped node box.
 */
export const SchemaNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const schemaText = typeof config['schema'] === 'string' ? config['schema'] : ''

  const left: ScenarioNodeSection[] = [{
    id: 'main',
    rows: [
      {
        id: 'value',
        label: t('scenario.schema.value', 'value'),
        port: { id: 'value', type: 'target' },
        content: (
          <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
            <TypedValueField
              value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
              onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              excludeTypes={STRING_VALUE_EXCLUDE}
              allowAllVariables
              dataTestId={`scn-schema-value-${id}`}
              multilineLanguage="json"
            />
          </div>
        )
      },
      {
        id: 'schema',
        port: { id: 'schema', type: 'target' },
        content: (
          <ScenarioCodeField
            value={schemaText}
            onChange={(next) => { data.onSetConfig?.(id, { schema: next }) }}
            language="json"
            caption={t('scenario.schema.schema', 'JSON Schema')}
            modalTitle={t('scenario.schema.editTitle', 'Edit JSON Schema')}
            placeholder={'{ "type": "object" }'}
            dataTestId="scn-schema-schema"
          />
        )
      }
    ]
  }]
  const right: ScenarioNodeCell[] = [
    { id: 'valid', label: t('scenario.schema.valid', 'valid'), port: { id: 'valid', role: 'then', type: 'source' } },
    { id: 'invalid', label: t('scenario.schema.invalid', 'invalid'), port: { id: 'invalid', role: 'else', type: 'source' } },
    { id: 'errors', label: t('scenario.schema.errors', 'errors'), port: { id: 'errors', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/** `readFile` — reads the file at `path` → its text on `content`. */
export const ReadFileNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const left: ScenarioNodeSection[] = [{
    id: 'main',
    rows: [
      {
        id: 'path',
        label: t('scenario.readFile.path', 'path'),
        port: { id: 'path', type: 'target' },
        content: (
          <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
            <TypedValueField
              value={config['path'] !== undefined ? normalizeValueType(config['path']) : new StringValue('')}
              onChange={(next) => { data.onSetConfig?.(id, { path: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              excludeTypes={NON_STRING_TYPES}
              allowAllVariables
              dataTestId={`scn-readfile-path-${id}`}
            />
          </div>
        )
      }
    ]
  }]
  const right: ScenarioNodeCell[] = [
    { id: 'content', label: t('scenario.readFile.content', 'content'), port: { id: 'content', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

/** `writeFile` — writes / appends `content` to the file at `path`. Terminal. */
export const WriteFileNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const mode = config['mode'] === 'append' ? 'append' : 'replace'

  const left: ScenarioNodeSection[] = [{
    id: 'main',
    rows: [
      {
        id: 'path',
        label: t('scenario.writeFile.path', 'path'),
        port: { id: 'path', type: 'target' },
        content: (
          <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
            <TypedValueField
              value={config['path'] !== undefined ? normalizeValueType(config['path']) : new StringValue('')}
              onChange={(next) => { data.onSetConfig?.(id, { path: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              excludeTypes={NON_STRING_TYPES}
              allowAllVariables
              dataTestId={`scn-writefile-path-${id}`}
            />
          </div>
        )
      },
      {
        id: 'mode',
        content: (
          <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
            <div className="scn-field-caption">{t('scenario.writeFile.mode', 'mode')}</div>
            <SegmentedToggle
              options={WRITE_MODES}
              value={mode}
              onChange={(next) => { data.onSetConfig?.(id, { mode: next }) }}
              ariaLabel={t('scenario.writeFile.mode', 'mode')}
            />
          </div>
        )
      },
      {
        id: 'content',
        label: t('scenario.writeFile.content', 'content'),
        port: { id: 'content', type: 'target' },
        content: (
          <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
            <TypedValueField
              value={config['content'] !== undefined ? normalizeValueType(config['content']) : new StringValue('')}
              onChange={(next) => { data.onSetConfig?.(id, { content: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              allowAllVariables
              multilineLanguage="plaintext"
              dataTestId={`scn-writefile-content-${id}`}
            />
          </div>
        )
      }
    ]
  }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} />
}
