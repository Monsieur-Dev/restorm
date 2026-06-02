import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { isRequest } from '../../../../../shared/types/collections'
import type { KeyValue } from '../../../../../shared/types/baseTypes'
import { Badge } from '../../common/Badge'
import { requestBadgeType } from '../../../utils/badgeUtils'
import { useScenarioBoundResolver, useScenarioRequestEnv } from '../scenarioBoundResolver'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { EnvironmentValue } from '../../../../../shared/types/collections'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/** The request node's `env` field is pinned to the `environment` type: every
 * other concrete type is excluded, leaving the env picker plus — via the
 * Variables submenu — variables *declared* of type environment (a variable's
 * own type must survive the filter, and only `environment` does here). */
const ENV_PINNED_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti'
]

/** Best-effort one-line display of a KeyValue's (typed) value. */
function displayValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o['type'] === 'password') return '••••••'
    if (typeof o['label'] === 'string') return o['label'] // CustomListValue
    const inner = o['value']
    if (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean') return String(inner)
    if (Array.isArray(inner)) return inner.join(', ')
    if (inner instanceof Date) return inner.toISOString()
  }
  return ''
}

/** A collapsible section of KV rows (one anchor per row), or null if empty. */
function kvSection(id: string, name: string, kvs: KeyValue[] | undefined): ScenarioNodeSection | null {
  const rows = (kvs ?? [])
    .filter((kv) => kv.enabled !== false && kv.key)
    .map((kv): ScenarioNodeCell => ({
      id: `${id}:${kv.key}`,
      label: kv.key,
      value: displayValue(kv.value),
      ...(kv.description ? { tooltip: kv.description } : {}),
      port: { id: `${id}:${kv.key}`, type: 'target' }
    }))
  return rows.length > 0 ? { id, name, rows } : null
}

/**
 * `request` node — bound to a saved request (`config.requestId`). The header
 * shows its method badge + live name; the left column mirrors the request's
 * structure as collapsible sections (headers / path params / params / body),
 * each row a `name ↔ value` pair with a grey input anchor (and the value's
 * description as a hover tooltip on the name). All resolved live from the tree.
 */
export const RequestNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const resolve = useScenarioBoundResolver()
  const resolveEnv = useScenarioRequestEnv()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const requestId = typeof data.config?.['requestId'] === 'string' ? data.config['requestId'] : undefined
  const item = requestId && resolve ? resolve(requestId) : null
  const request = item && isRequest(item) ? item : null
  const envInfo = requestId && resolveEnv ? resolveEnv(requestId) : null

  const fallbackLabel = typeof data.config?.['label'] === 'string' ? data.config['label'] : undefined
  const title = request?.name ?? fallbackLabel
  const headerIcon = request ? <Badge type={requestBadgeType(request)} /> : undefined

  // Protocols carry these arrays under common names; read defensively so a
  // non-HTTP request simply yields no sections rather than throwing.
  const r = (request ?? {}) as { headers?: KeyValue[]; params?: KeyValue[]; pathParams?: KeyValue[]; body?: unknown }
  const bodySection: ScenarioNodeSection | null = r.body
    ? { id: 'body', name: 'Body', rows: [{ id: 'body', label: 'body', port: { id: 'body', type: 'target' } }] }
    : null
  // Nameless section with the env field — only when the request sits under an
  // environment folder. A value selector pinned to the `environment` type: the
  // picker lists every env across all folders, defaulting to the request's base
  // pinned env, and the Variables submenu surfaces environment-typed variables.
  // Carries an optional `env` data input so an upstream link can drive it too.
  const envSection: ScenarioNodeSection | null = envInfo
    ? {
      id: 'env',
      rows: [{
        id: 'env',
        port: { id: 'env', type: 'target' },
        content: (
          <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
            <TypedValueField
              value={data.config?.['env'] !== undefined ? normalizeValueType(data.config['env']) : new EnvironmentValue(envInfo.selectedEnvId ?? '')}
              onChange={(next) => { data.onSetConfig?.(id, { env: serializeValueForPersistence(next) }) }}
              valueTypeGroups={valueTypeGroups}
              excludeTypes={ENV_PINNED_EXCLUDE}
              allowEnvironment
              dataTestId="scn-request-env"
            />
          </div>
        )
      }]
    }
    : null
  // First body line: a link to open the bound request in a workbench tab.
  const editSection: ScenarioNodeSection | null = (request && requestId && data.onOpenItem)
    ? {
      id: 'edit',
      rows: [{
        id: 'edit',
        content: (
          <button
            type="button"
            className="scn-edit-link nodrag"
            data-testid="scn-request-edit-link"
            onClick={(e) => { e.stopPropagation(); data.onOpenItem?.(requestId) }}
          >
            {t('scenario.editRequest', 'Edit request')}
          </button>
        )
      }]
    }
    : null
  const left: ScenarioNodeSection[] = [
    editSection,
    envSection,
    kvSection('headers', 'Headers', r.headers),
    kvSection('pathParams', 'Path Params', r.pathParams),
    kvSection('params', 'Params', r.params),
    bodySection
  ].filter((s): s is ScenarioNodeSection => s !== null)

  const right: ScenarioNodeCell[] = [
    { id: 'response', label: 'response', port: { id: 'response', role: 'response', type: 'source' } }
  ]
  return (
    <ScenarioNodeBoxBase
      id={id}
      data={data}
      selected={selected}
      left={left}
      right={right}
     
      {...(headerIcon ? { headerIcon } : {})}
      {...(title ? { title } : {})}
    />
  )
}

export default RequestNodeBox
