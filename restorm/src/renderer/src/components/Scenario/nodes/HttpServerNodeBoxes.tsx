import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { RegistryBadge } from '../../common/RegistryBadge'
import { httpBadgeIdFor } from '../../../../../shared/utils/httpMethod'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ConnectionPicker } from './SocketioNodeBoxes'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { isRequest } from '../../../../../shared/types/collections'
import { useStreamingOverrideSections } from './scenarioOverridePorts'

const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

/**
 * A (httpListen) — HOSTS a local HTTP mock server: a long-lived listener, NOT a
 * one-shot request (so there is NO `response` output). `connected` (a pure
 * signal) fires once the server is listening ("Démarré"); `served` re-emits each
 * served request's `{ request, response }` data; the implicit `done` fires when
 * an httpClose node (or a Stop) ends it.
 */
export const HttpListenNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const connectionName = typeof config['connectionName'] === 'string' ? config['connectionName'] : ''
  const requestId = typeof config['requestId'] === 'string' ? config['requestId'] : undefined

  // The header shows the bound request's method as the "SRV" server capsule.
  const resolve = useScenarioBoundResolver()
  const boundItem = requestId && resolve ? resolve(requestId) : null
  const boundRequest = boundItem && isRequest(boundItem) ? boundItem : null
  const method = boundRequest && (boundRequest as { method?: string }).method
    ? (boundRequest as { method: string }).method
    : 'GET'
  const overrideSections = useStreamingOverrideSections(boundRequest, config, (patch) => { data.onSetConfig?.(id, patch) })

  const left: ScenarioNodeSection[] = [
    ...(requestId && data.onOpenItem
      ? [{
          id: 'edit',
          rows: [{
            id: 'edit',
            content: (
              <Button
                externalLink
                className="nodrag"
                data-testid="scn-request-edit-link"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); data.onOpenItem?.(requestId) }}
              >
                {t('scenario.editRequest', 'Edit request')}
              </Button>
            )
          }]
        }]
      : []),
    ...overrideSections,
    {
      id: 'main',
      rows: [
        {
          id: 'connectionName',
          content: (
            <div className="nodrag" onMouseDown={stop}>
              <div className="scn-field-caption">{t('scenario.socketio.connectionNameLabel', 'Connection name')}</div>
              <ScenarioNameInput
                value={connectionName}
                placeholder={t('scenario.socketio.connectionNamePlaceholder', 'connection name')}
                onCommit={(next) => { data.onSetConfig?.(id, { connectionName: next }) }}
                data-testid="scn-http-connection-name"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'connected', label: t('scenario.socketio.started', 'started'), port: { id: 'connected', type: 'source', flow: 'signal' } },
    { id: 'served', label: t('scenario.http.served', 'served'), port: { id: 'served', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} headerIcon={<RegistryBadge badgeId={httpBadgeIdFor(method)} text={method} server />} />
}

/** C (httpClose) — stops a declared HTTP mock server; sequences via `done`. */
export const HttpCloseNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'connection', content: <ConnectionPicker id={id} data={data} kind="httpListen" /> }] }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<RegistryBadge badgeId="http_server_close" />} />
}
