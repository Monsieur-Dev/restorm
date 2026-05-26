import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence, type PersistedValue } from '../../../../../shared/utils/valuePersistence'

interface SwitchCase {
  id: string
  value: PersistedValue
}

function caseId(): string {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readCases(config: Record<string, unknown>): SwitchCase[] {
  const raw = config['cases']
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is SwitchCase => typeof c === 'object' && c !== null && typeof (c as { id?: unknown }).id === 'string')
}

/**
 * `switch` node — routes the `on` value to the first matching case. The `on`
 * input is a typed-value selector (literal / variable, optional) that swaps to
 * the JSON-path selector when a link is connected; each case carries its own
 * value selector + a case output, and the type menu on a case offers
 * "Supprimer" to drop it. The "+" appends a case. Cases + `on` persist in the
 * node config; case outputs are rendered from the config (their signal flow is
 * derived). A header trigger lets an upstream `event` launch the switch.
 */
export const SwitchNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const cases = readCases(config)

  const setCases = (next: SwitchCase[]): void => { data.onSetConfig?.(id, { cases: next }) }

  const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'on',
          label: 'on',
          port: { id: 'on', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={stop}>
              <TypedValueField
                value={normalizeValueType(config['on'])}
                onChange={(next) => { data.onSetConfig?.(id, { on: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={['expression']}
                allowEnvironment
                dataTestId="scn-switch-on"
              />
            </div>
          )
        }
      ]
    }
  ]

  const right: ScenarioNodeCell[] = [
    ...cases.map((c): ScenarioNodeCell => ({
      id: c.id,
      content: (
        <div className="nodrag" onMouseDown={stop}>
          <TypedValueField
            value={normalizeValueType(c.value)}
            onChange={(next) => { setCases(cases.map((x) => (x.id === c.id ? { ...x, value: serializeValueForPersistence(next) } : x))) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={['expression']}
            allowEnvironment
            onRemove={() => { setCases(cases.filter((x) => x.id !== c.id)) }}
            removeLabel={t('scenario.switch.removeCase', 'Supprimer')}
            dataTestId={`scn-switch-${c.id}`}
          />
        </div>
      ),
      port: { id: c.id, role: 'case', type: 'source' }
    })),
    {
      id: 'add-case',
      content: (
        <Button
          small
          secondary
          icon="add"
          onClick={() => { setCases([...cases, { id: caseId(), value: { type: 'string', value: '' } }]) }}
          options={{ ariaLabel: t('scenario.switch.addCase', 'Add case'), title: t('scenario.switch.addCase', 'Add case') }}
          data-testid="scenario-switch-add-case"
        />
      )
    },
    { id: 'default', label: 'default', port: { id: 'default', role: 'default', type: 'source' } }
  ]

  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} launchInput />
}

export default SwitchNodeBox
