import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { Badge } from '../../common/Badge'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ConnectionPicker } from './SocketioNodeBoxes'

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
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} headerIcon={<Badge type="GRPC" mode="server" />} />
}

/** C (grpcServerClose) — stops a declared gRPC mock server; sequences via `done`. */
export const GrpcServerCloseNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'connection', content: <ConnectionPicker id={id} data={data} kind="grpcListen" /> }] }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<Badge type="GRPC" mode="server" icon="debug-disconnect" />} />
}
