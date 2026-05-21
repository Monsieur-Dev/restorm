import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { isRequest } from '../../../../../shared/types/collections'
import type { KeyValue } from '../../../../../shared/types/baseTypes'
import { Badge } from '../../common/Badge'
import { requestBadgeType } from '../../../utils/badgeUtils'
import { useScenarioBoundResolver, useScenarioRequestEnv } from '../scenarioBoundResolver'
import { EnvButtonCell } from './EnvButtonCell'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

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
  const resolve = useScenarioBoundResolver()
  const resolveEnv = useScenarioRequestEnv()
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
  // Nameless section with the env-selector button — only when the request
  // sits under an environment folder (no left anchor, like the If operator).
  const envSection: ScenarioNodeSection | null = envInfo
    ? { id: 'env', rows: [{ id: 'env', content: <EnvButtonCell environments={envInfo.environments} defaultEnvId={envInfo.selectedEnvId} /> }] }
    : null
  const left: ScenarioNodeSection[] = [
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
      launchInput
      canPlay
      {...(headerIcon ? { headerIcon } : {})}
      {...(title ? { title } : {})}
    />
  )
}

export default RequestNodeBox
