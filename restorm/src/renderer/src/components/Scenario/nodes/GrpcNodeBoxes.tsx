import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { isRequest } from '../../../../../shared/types/collections'
import { Badge } from '../../common/Badge'
import { requestBadgeType } from '../../../utils/badgeUtils'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ScenarioCodeField } from './ScenarioCodeField'
import { ConnectionPicker } from './SocketioNodeBoxes'
import { readCodeString } from './scenarioCodeValue'

const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

/**
 * A (grpcConnect) — opens a long-lived streaming gRPC call (server / client /
 * bidi, inferred from the bound request's call type). A streaming RPC has no
 * named events, so a single `message` port re-emits every received frame.
 * `connected` fires once the call opens; the implicit `done` fires when a close
 * node (or a Stop) ends it.
 */
export const GrpcConnectNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const connectionName = typeof config['connectionName'] === 'string' ? config['connectionName'] : ''
  const requestId = typeof config['requestId'] === 'string' ? config['requestId'] : undefined
  // Show the bound request's CALL-TYPE badge (S-STR / C-STR / BIDI) so the
  // stream direction stays visible on the box — a streaming gRPC request dropped
  // here keeps its meaning instead of collapsing to a generic "gRPC". Falls back
  // to the generic GRPC badge when nothing is bound yet.
  const resolve = useScenarioBoundResolver()
  const boundItem = requestId && resolve ? resolve(requestId) : null
  const boundRequest = boundItem && isRequest(boundItem) ? boundItem : null
  const headerIcon = boundRequest
    ? <Badge type={requestBadgeType(boundRequest)} />
    : <Badge type="GRPC" icon="plug" />

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
                data-testid="scn-grpc-connection-name"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'connected', label: t('scenario.socketio.connected', 'connected'), port: { id: 'connected', type: 'source', flow: 'signal' } },
    { id: 'message', label: t('scenario.grpc.message', 'message'), port: { id: 'message', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} headerIcon={headerIcon} />
}

/** B (grpcSend) — writes a request message on a declared call (client / bidi). */
export const GrpcSendNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'connection', content: <ConnectionPicker id={id} data={data} kind="grpcConnect" prefill /> },
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
              placeholder={'{\n  "f_string": "hello"\n}'}
              dataTestId={`scn-grpc-payload-${id}`}
            />
          )
        }
      ]
    }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<Badge type="GRPC" icon="arrow-up" />} />
}

/** C (grpcClose) — half-closes a declared streaming call; sequences via `done`. */
export const GrpcCloseNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'connection', content: <ConnectionPicker id={id} data={data} kind="grpcConnect" /> }] }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<Badge type="GRPC" icon="debug-disconnect" />} />
}
