import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { Button, InputBox, SelectBox, type ISelectData } from 'electron-core-ui/renderer'
import { RegistryBadge } from '../../common/RegistryBadge'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { TypedValueField } from '../../TypedValueField'
import { ScenarioCodeField } from './ScenarioCodeField'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { readSocketioEvents } from '../../../../../shared/scenarioNodePorts'
import { useScenarioConnections } from '../scenarioConnectionsContext'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { isRequest } from '../../../../../shared/types/collections'
import { readCodeString } from './scenarioCodeValue'
import { useStreamingOverrideSections } from './scenarioOverridePorts'

const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

/**
 * A (socketioConnect) — declares + opens a long-lived Socket.IO connection.
 * The connection NAME (unique per scenario) is referenced by send/close nodes.
 * Output is switch-like: one `event:<name>` port per listened event (seeded with
 * the bound request's event), a "+" to add events, and an `others` catch-all
 * (the switch `default` analogue). `connected` fires once the socket is open;
 * the implicit `done` fires when a close node (or a Stop) ends it.
 */
export const SocketioConnectNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const events = readSocketioEvents(config)
  const connectionName = typeof config['connectionName'] === 'string' ? config['connectionName'] : ''
  const requestId = typeof config['requestId'] === 'string' ? config['requestId'] : undefined

  // When the bound request is a Socket.IO SERVER (restorm hosts it), the node
  // header shows the "SRV" server capsule so a server connect reads distinctly
  // from a client connect at a glance.
  const resolve = useScenarioBoundResolver()
  const boundItem = requestId && resolve ? resolve(requestId) : null
  const boundRequest = boundItem && isRequest(boundItem) ? boundItem : null
  const isServerBound = !!boundRequest && (boundRequest as { server?: boolean }).server === true
  const overrideSections = useStreamingOverrideSections(boundRequest, config, (patch) => { data.onSetConfig?.(id, patch) })

  const setEvents = (next: string[]): void => { data.onSetConfig?.(id, { events: next }) }

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
                data-testid="scn-socketio-connection-name"
              />
            </div>
          )
        }
      ]
    }
  ]

  const right: ScenarioNodeCell[] = [
    { id: 'connected', label: isServerBound ? t('scenario.socketio.started', 'started') : t('scenario.socketio.connected', 'connected'), port: { id: 'connected', type: 'source', flow: 'signal' } },
    // A single caption over the channel (event) inputs — not one per input.
    { id: 'channel-caption', content: <div className="scn-field-caption" style={{ textAlign: 'right' }}>{t('scenario.socketio.channelLabel', 'Channel name')}</div> },
    ...events.map((name, i): ScenarioNodeCell => ({
      id: `event:${name}`,
      content: (
        <div className="nodrag" onMouseDown={stop}>
          <InputBox
            className="scn-name-input"
            options={{ placeholder: t('scenario.socketio.eventPlaceholder', 'event'), ariaLabel: t('scenario.socketio.eventPlaceholder', 'event') }}
            value={name}
            onChange={(next) => {
              const trimmed = next.trim()
              const copy = [...events]
              if (trimmed === '') copy.splice(i, 1)
              else copy[i] = trimmed
              setEvents(copy)
            }}
            data-testid={`scn-socketio-event-${i}`}
          />
        </div>
      ),
      port: { id: `event:${name}`, role: 'case', type: 'source' }
    })),
    {
      id: 'add-event',
      content: (
        <Button
          small
          secondary
          icon="add"
          onClick={() => { setEvents([...events, `event${events.length + 1}`]) }}
          options={{ ariaLabel: t('scenario.socketio.addEvent', 'Add event') }}
          data-testid="scn-socketio-add-event"
        />
      )
    },
    { id: 'others', label: t('scenario.socketio.others', 'others'), port: { id: 'others', role: 'default', type: 'source' } }
  ]

  const headerIcon = isServerBound ? <RegistryBadge badgeId="sio_server" /> : <RegistryBadge badgeId="sio_connect" />
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} headerIcon={headerIcon} />
}

/** True when a persisted typed value carries no usable content (unset, or an
 * empty string) — used to decide whether a send node's channel/payload is free
 * to pre-fill on connection selection. */
function isBlankValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  const inner = (v as { value?: unknown }).value
  return typeof inner === 'string' ? inner.trim() === '' : inner === undefined
}

/** A SelectBox-like connection picker shared by send / close (Socket.IO + raw
 * WebSocket). Filters the connections to the matching transport `kind`. Falls
 * back to a read-only label when rendered outside the editor (no connections
 * context). When `prefill` is set, selecting a connection seeds the send node's
 * channel/payload from the connect node's linked request (only when blank, so a
 * user edit is never clobbered). */
export const ConnectionPicker: React.FC<{ id: string; data: ScenarioNodeBoxType['data']; kind: 'socketioConnect' | 'websocketConnect' | 'stompConnect' | 'sseConnect' | 'grpcConnect' | 'mqttConnect' | 'amqpConnect' | 'redisSubscribe' | 'kafkaConsume' | 'httpListen' | 'grpcListen' | 'soapListen' | 'graphqlListen' | 'odataListen' | 'graphqlSubscribe'; prefill?: boolean }> = ({ id, data, kind, prefill }) => {
  const { t } = useTranslation()
  const connections = useScenarioConnections().filter((c) => c.kind === kind)
  const config = data.config ?? {}
  const selectedId = typeof config['connectionNodeId'] === 'string' ? config['connectionNodeId'] : ''
  // A leading placeholder row + one row per declared connection. The display
  // name comes from the connect node's config; a dangling reference (its connect
  // node was deleted) leaves the placeholder selected so the editor flags it.
  const options = [
    { text: '', label: t('scenario.socketio.pickConnection', '— pick a connection —') },
    ...connections.map((c) => ({ text: c.id, label: c.name || c.id }))
  ]
  const selectedIndex = Math.max(0, connections.findIndex((c) => c.id === selectedId) + 1)
  return (
    <div className="nodrag" onMouseDown={stop}>
      <div className="scn-field-caption">{t('scenario.socketio.connection', 'connection')}</div>
      <SelectBox
        id={`scn-stream-connection-${id}`}
        className=""
        options={options}
        selected={selectedIndex}
        onDidSelect={(d: ISelectData) => {
          const conn = d.index === 0 ? undefined : connections[d.index - 1]
          const picked = conn?.id ?? ''
          const patch: Record<string, unknown> = { connectionNodeId: picked }
          // Pre-fill channel + payload from the connection's linked request, but
          // only when the field is still blank (don't clobber a user edit).
          if (prefill && conn) {
            if (conn.defaultChannel !== undefined && isBlankValue(config['channel'])) {
              patch['channel'] = { type: 'string', value: conn.defaultChannel }
            }
            if (conn.defaultPayload !== undefined && isBlankValue(config['payload'])) {
              patch['payload'] = { type: 'string', value: conn.defaultPayload }
            }
          }
          data.onSetConfig?.(id, patch)
        }}
        data-testid="scn-socketio-connection-select"
      />
    </div>
  )
}

/**
 * B (socketioSend) — emits a message on a declared connection. A connection
 * picker selects the connect node; `channel` + `payload` carry input ports (and
 * inline fallbacks). Continues on `sent`.
 */
export const SocketioSendNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'connection', content: <ConnectionPicker id={id} data={data} kind="socketioConnect" prefill /> },
        {
          id: 'channel',
          port: { id: 'channel', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={stop}>
              <div className="scn-field-caption">{t('scenario.socketio.channelLabel', 'Channel name')}</div>
              <TypedValueField
                value={normalizeValueType(config['channel'])}
                onChange={(next) => { data.onSetConfig?.(id, { channel: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_VALUE_EXCLUDE}
                allowEnvironment
                dataTestId="scn-socketio-channel"
              />
            </div>
          )
        },
        {
          id: 'payload',
          label: t('scenario.socketio.payload', 'payload'),
          port: { id: 'payload', type: 'target' },
          // The payload is a free-form message body → a JSON code editor (the
          // same field the Code node uses), with the full-screen modal. It can
          // also be wired (the `payload` port wins at run time).
          content: (
            <ScenarioCodeField
              value={readCodeString(config['payload'])}
              onChange={(next) => { data.onSetConfig?.(id, { payload: next }) }}
              language="json"
              caption={t('scenario.socketio.payload', 'payload')}
              modalTitle={t('scenario.socketio.payloadModalTitle', 'Edit payload')}
              placeholder={'{\n  "hello": "world"\n}'}
              dataTestId={`scn-socketio-payload-${id}`}
            />
          )
        }
      ]
    }
  ]
  // No explicit output — the action sequences via the universal `done` port.
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<RegistryBadge badgeId="sio_send" />} />
}

/** C (socketioClose) — closes a declared connection; sequences via `done`. */
export const SocketioCloseNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'connection', content: <ConnectionPicker id={id} data={data} kind="socketioConnect" /> }] }
  ]
  // No explicit output — the action sequences via the universal `done` port.
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} headerIcon={<RegistryBadge badgeId="sio_close" />} />
}
