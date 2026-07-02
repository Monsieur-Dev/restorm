import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { Badge } from '../../common/Badge'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ScenarioCodeField } from './ScenarioCodeField'
import { ConnectionPicker } from './SocketioNodeBoxes'
import { readCodeString } from './scenarioCodeValue'
import { useStreamingOverrideSections } from './scenarioOverridePorts'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { isRequest } from '../../../../../shared/types/collections'

const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

/**
 * A (amqpConnect) — opens a long-lived AMQP connection and consumes the bound
 * request's queue (`mode: subscribe`). AMQP has no named events, so a single
 * `message` port re-emits every received/delivered message. `connected` fires
 * once the consumer is registered; the implicit `done` fires when a close node
 * (or a Stop) ends it. Not server-capable (v1) — always a client, unlike
 * `MqttConnectNodeBox` there is no "SRV" header variant.
 */
export const AmqpConnectNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
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
                data-testid="scn-amqp-connection-name"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'connected', label: t('scenario.socketio.connected', 'connected'), port: { id: 'connected', type: 'source', flow: 'signal' } },
    { id: 'message', label: t('scenario.websocket.message', 'message'), port: { id: 'message', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} headerIcon={<Badge type="AMQP" icon="plug" />} />
}

/** B (amqpPublish) — publishes a payload on a declared connection (to the bound
 * request's own exchange/routing key). */
export const AmqpPublishNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'connection', content: <ConnectionPicker id={id} data={data} kind="amqpConnect" prefill /> },
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
              dataTestId={`scn-amqp-payload-${id}`}
            />
          )
        }
      ]
    }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<Badge type="AMQP" icon="arrow-up" />} />
}

/** C (amqpClose) — closes a declared connection; sequences via `done`. */
export const AmqpCloseNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'connection', content: <ConnectionPicker id={id} data={data} kind="amqpConnect" /> }] }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<Badge type="AMQP" icon="debug-disconnect" />} />
}
