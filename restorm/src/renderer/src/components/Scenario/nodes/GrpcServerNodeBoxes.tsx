import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { RegistryBadge } from '../../common/RegistryBadge'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ConnectionPicker } from './SocketioNodeBoxes'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { isRequest } from '../../../../../shared/types/collections'
import { useStreamingOverrideSections } from './scenarioOverridePorts'

const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

/**
 * A (grpcListen) — HOSTS a local gRPC mock server: a long-lived listener, NOT a
 * one-shot request (so there is NO `response` output). `connected` (a pure
 * signal) fires once the server is listening ("Démarré"); `served` re-emits each
 * served call's `{ request, response }` data; the implicit `done` fires when a
 * grpcServerClose node (or a Stop) ends it.
 */
export const GrpcListenNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const connectionName = typeof config['connectionName'] === 'string' ? config['connectionName'] : ''
  const requestId = typeof config['requestId'] === 'string' ? config['requestId'] : undefined
  const resolve = useScenarioBoundResolver()
  const boundItem = requestId && resolve ? resolve(requestId) : null
  const boundRequest = boundItem && isRequest(boundItem) ? boundItem : null
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
                data-testid="scn-grpc-server-connection-name"
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
  // The header shows the gRPC server (SRV) capsule.
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} headerIcon={<RegistryBadge badgeId="grpc_server" />} />
}

/** C (grpcServerClose) — stops a declared gRPC mock server; sequences via `done`. */
export const GrpcServerCloseNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'connection', content: <ConnectionPicker id={id} data={data} kind="grpcListen" /> }] }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<RegistryBadge badgeId="grpc_server_close" />} />
}
