import React from 'react'
import { type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { InputBox } from 'electron-core-ui/renderer'
import { type ScenarioNodeBoxType, ScenarioNodeBoxBase, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'
import { SegmentedToggle } from './SegmentedToggle'

export const TOAST_LEVELS = ['info', 'success', 'warning', 'error'] as const
export type ToastLevel = (typeof TOAST_LEVELS)[number]

/**
 * `toast` — emits a UI notification in the Restorm toaster from a running
 * scenario. A side-effect node (like `log`): fires the toast and signals `done`
 * so the flow can continue.
 *
 * Fields: `level` (info / success / warning / error toggle — drives the toast's
 * glyph + colour), `title` (header text, wireable string/expression), `message`
 * (body text below the title, wireable string/expression) and `duration` — a
 * plain number of SECONDS (`0` = persists until dismissed). Headless runs:
 * no-op in main, `done` still fires.
 */
export const ToastNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const rawLevel = config['level']
  const level: ToastLevel = typeof rawLevel === 'string' && (TOAST_LEVELS as readonly string[]).includes(rawLevel)
    ? (rawLevel as ToastLevel)
    : 'info'

  // Duration is a plain number of seconds. Stored directly as a number; 0 (or
  // unset) means the toast is not time-limited.
  const rawDuration = config['duration']
  const durationSeconds = typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : 0

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'level',
          content: (
            <SegmentedToggle
              options={TOAST_LEVELS}
              value={level}
              onChange={(l) => { data.onSetConfig?.(id, { level: l }) }}
              ariaLabel="level"
            />
          )
        },
        {
          id: 'title',
          label: t('scenario.toast.title', 'title'),
          port: { id: 'title', type: 'target' },
          content: (
            <div className="nodrag scn-stacked-field" onMouseDown={(e) => { e.stopPropagation() }}>
              <span className="scn-port-label">{t('scenario.toast.title', 'title')}</span>
              <TypedValueField
                value={config['title'] !== undefined ? normalizeValueType(config['title']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { title: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_VALUE_EXCLUDE}
                allowAllVariables
                dataTestId="scn-toast-title"
              />
            </div>
          )
        },
        {
          id: 'message',
          label: t('scenario.toast.message', 'message'),
          port: { id: 'message', type: 'target' },
          content: (
            <div className="nodrag scn-stacked-field" onMouseDown={(e) => { e.stopPropagation() }}>
              <span className="scn-port-label">{t('scenario.toast.message', 'message')}</span>
              <TypedValueField
                value={config['message'] !== undefined ? normalizeValueType(config['message']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { message: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_VALUE_EXCLUDE}
                allowAllVariables
                dataTestId="scn-toast-message"
              />
            </div>
          )
        },
        {
          id: 'duration',
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <div className="scn-field-caption">{t('scenario.toast.duration', 'duration (s)')}</div>
              <InputBox
                value={durationSeconds > 0 ? String(durationSeconds) : ''}
                onChange={(next) => {
                  const n = Math.max(0, Number(next) || 0)
                  data.onSetConfig?.(id, { duration: n })
                }}
                options={{ type: 'number', min: 0, ariaLabel: t('scenario.toast.duration', 'duration (s)') }}
                data-testid="scn-toast-duration"
              />
            </div>
          )
        }
      ]
    }
  ]

  // Side-effect node: no value output — `done` and `error` are drawn implicitly
  // by the base (a title/message expression can fail to render at runtime).
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} />
}
