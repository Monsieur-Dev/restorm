import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { Badge } from '../../common/Badge'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ScenarioCodeField } from './ScenarioCodeField'
import { ConnectionPicker } from './SocketioNodeBoxes'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { isRequest } from '../../../../../shared/types/collections'
import { readCodeString } from './scenarioCodeValue'

const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

/**
 * A (websocketConnect) — opens a long-lived RAW WebSocket connection. Unlike
 * Socket.IO there are no named events, so a single `message` port re-emits every
 * received frame (no `event:<name>` ports, no "+", no `others`). `connected`
 * fires once open; the implicit `done` fires when a close node (or a Stop) ends it.
 */
export const WebsocketConnectNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const connectionName = typeof config['connectionName'] === 'string' ? config['connectionName'] : ''
  const requestId = typeof config['requestId'] === 'string' ? config['requestId'] : undefined

  // When the bound request HOSTS a server, the node header shows the "SRV"
  // server capsule + a "started" port label, distinct from a client connect.
  const resolve = useScenarioBoundResolver()
  const boundItem = requestId && resolve ? resolve(requestId) : null
  const isServerBound = !!boundItem && isRequest(boundItem) && (boundItem as { server?: boolean }).server === true

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
                data-testid="scn-websocket-connection-name"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'connected', label: isServerBound ? t('scenario.socketio.started', 'started') : t('scenario.socketio.connected', 'connected'), port: { id: 'connected', type: 'source', flow: 'signal' } },
    { id: 'message', label: t('scenario.websocket.message', 'message'), port: { id: 'message', type: 'source' } }
  ]
  const headerIcon = isServerBound ? <Badge type="WS" mode="server" /> : <Badge type="WS" icon="plug" />
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} headerIcon={headerIcon} />
}

/** B (websocketSend) — sends a raw payload on a declared connection (no channel). */
export const WebsocketSendNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'connection', content: <ConnectionPicker id={id} data={data} kind="websocketConnect" prefill /> },
        {
          id: 'payload',
          label: t('scenario.socketio.payload', 'payload'),
          port: { id: 'payload', type: 'target' },
          content: (
            <ScenarioCodeField
              value={readCodeString(config['payload'])}
              onChange={(next) => { data.onSetConfig?.(id, { payload: next }) }}
              language="json"
              caption={t('scenario.socketio.payload', 'payload')}
              modalTitle={t('scenario.socketio.payloadModalTitle', 'Edit payload')}
              placeholder={'{\n  "hello": "world"\n}'}
              dataTestId={`scn-websocket-payload-${id}`}
            />
          )
        }
      ]
    }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<Badge type="WS" icon="arrow-up" />} />
}

/** C (websocketClose) — closes a declared connection; sequences via `done`. */
export const WebsocketCloseNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'connection', content: <ConnectionPicker id={id} data={data} kind="websocketConnect" /> }] }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<Badge type="WS" icon="debug-disconnect" />} />
}
