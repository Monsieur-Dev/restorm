import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { useScenarioFieldInvalid } from '../scenarioErrorsContext'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { VariableValue } from '../../../../../shared/types/collections'

/** `getVariable` reads an existing variable: its selector is locked to the
 * `variable` kind (every other type excluded) and shows every variable
 * regardless of declared type. */
const VARIABLE_ONLY_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti'
]

const VALUE_OUT: ScenarioNodeCell = { id: 'value', label: 'value', port: { id: 'value', type: 'source' } }

/**
 * `input` — a named scenario parameter with a default typed value; produces
 * `value`. Runnable on its own, and chainable via the optional header launch
 * trigger. The name + the default value persist into the node's config bag.
 */
export const InputNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const name = typeof config['name'] === 'string' ? config['name'] : ''
  const nameInvalid = useScenarioFieldInvalid(id, 'name')
  const required = config['required'] === true
  // `normalizeValueType` already returns a StringValue('') for an absent
  // config, so this both rehydrates a saved typed value and seeds the default.
  const value = normalizeValueType(config['valueType'])

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'name',
          content: (
            <ScenarioNameInput
              value={name}
              placeholder="name"
              invalid={nameInvalid}
              onCommit={(next) => { data.onSetConfig?.(id, { name: next }) }}
            />
          )
        },
        {
          id: 'default',
          content: (
            <div
              className="nodrag"
              onMouseDown={(e) => { e.stopPropagation() }}
            >
              <div className="scn-field-caption">Default / type</div>
              <TypedValueField
                value={value}
                onChange={(next) => { data.onSetConfig?.(id, { valueType: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={['expression']}
                allowEnvironment
                dataTestId="scn-input"
              />
            </div>
          )
        },
        {
          id: 'required',
          content: (
            <label className="scn-required-toggle nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => { data.onSetConfig?.(id, { required: e.target.checked }) }}
                data-testid="scn-input-required"
              />
              <span>{t('scenario.input.required', 'Required')}</span>
            </label>
          )
        }
      ]
    }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[VALUE_OUT]} launchInput canPlay />
}

/**
 * `output` — declares a named scenario output (the symmetric counterpart of
 * `input`): a name + a `value` input port. The value wired in is exposed as one
 * of the scenario's outputs, which a parent `runScenario` derives into an output
 * port. Terminal sink — no output, no error port. The name persists in config.
 */
export const OutputNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const config = data.config ?? {}
  const name = typeof config['name'] === 'string' ? config['name'] : ''
  const nameInvalid = useScenarioFieldInvalid(id, 'name')
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'name',
          content: (
            <ScenarioNameInput
              value={name}
              placeholder="output"
              invalid={nameInvalid}
              onCommit={(next) => { data.onSetConfig?.(id, { name: next }) }}
            />
          )
        },
        { id: 'value', label: 'value', port: { id: 'value', type: 'target' } }
      ]
    }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} hasError={false} />
}

/** `getVariable` — reads a named variable; produces `value`. Runnable (no input). */
/**
 * `getVariable` — reads a named variable; produces `value`. The variable is
 * chosen via a value selector locked to the `variable` kind (so the only choice
 * is picking an existing variable, of any type). A header trigger lets the read
 * be sequenced; it's also runnable on its own. The reference persists in config.
 */
export const GetVariableNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const selectorInvalid = useScenarioFieldInvalid(id, 'value')
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'name',
          content: (
            <div className={`nodrag${selectorInvalid ? ' scn-field-invalid' : ''}`} onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={config['value'] !== undefined ? normalizeValueType(config['value']) : new VariableValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={VARIABLE_ONLY_EXCLUDE}
                allowAllVariables
                allowEnvironment
                dataTestId="scn-getvar"
              />
            </div>
          )
        }
      ]
    }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[VALUE_OUT]} launchInput canPlay />
}

/**
 * `setVariable` — stores a value into a named variable, passing it through to
 * `out`. The value is a typed-value selector (literal value + type) when
 * unwired — so you can set a literal without a link, and the anchor stays
 * neutral rather than red/required — and {@link ScenarioInputCell} swaps it for
 * the JSON-path selector once a data link is connected. Name + value persist in
 * the node's config bag.
 */
export const SetVariableNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const name = typeof config['name'] === 'string' ? config['name'] : ''
  const nameInvalid = useScenarioFieldInvalid(id, 'name')

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'name',
          content: (
            <ScenarioNameInput
              value={name}
              placeholder="variable"
              invalid={nameInvalid}
              onCommit={(next) => { data.onSetConfig?.(id, { name: next }) }}
            />
          )
        },
        {
          id: 'value',
          label: 'value',
          port: { id: 'value', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={normalizeValueType(config['value'])}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={['expression']}
                excludeVariableName={name}
                allowEnvironment
                dataTestId="scn-setvar-value"
              />
            </div>
          )
        }
      ]
    }
  ]
  // No data `value` output: a setVariable stores its input into the named
  // variable (referenced elsewhere via the value selector's "Variables" menu)
  // and only emits a header `event` signal on completion to chain the next node.
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerEventOutput />
}
