import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, SelectBox, Toggle, type ISelectData, type VariableDefinition } from 'electron-core-ui/renderer'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { updateReactiveProperty } from './requestTabViewUtils'
import type { WebSocketRequest } from '../../../../shared/types/collections'

export interface MqttOptionsPanelProps {
  request: WebSocketRequest
  variables: VariableDefinition[]
  helpers: TranslatedHelperDefinition[]
}

const QOS_OPTIONS = [{ text: '0', label: 'QoS 0' }, { text: '1', label: 'QoS 1' }, { text: '2', label: 'QoS 2' }]

/** Row label + control, evenly aligned. */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontSize: 12, width: 96, flexShrink: 0, color: 'var(--foreground-muted)' }}>{label}</span>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
)

/**
 * MQTT connection + publish options (`protocol === 'mqtt'` only). Every text
 * field is Handlebars-aware (`RestormVariableInputBox`) and writes straight to
 * the reactive request, so the changes round-trip to the execution service via
 * `fullData` exactly like the topic / message. QoS + retain drive both the
 * on-connect subscribe and the Send-button publish.
 */
export const MqttOptionsPanel: React.FC<MqttOptionsPanelProps> = ({ request, variables, helpers }) => {
  const { t } = useTranslation()

  const [qos, setQosState] = useState(request.qos ?? 0)
  const [retain, setRetainState] = useState(request.retain === true)
  const [subscribe, setSubscribeState] = useState(request.mqttSubscribe !== false)
  const [clientId, setClientIdState] = useState(request.clientId ?? '')
  const [username, setUsernameState] = useState(request.username ?? '')
  const [password, setPasswordState] = useState(request.password ?? '')
  const [keepalive, setKeepaliveState] = useState(request.keepalive !== undefined ? String(request.keepalive) : '')
  const [lwtTopic, setLwtTopicState] = useState(request.lwtTopic ?? '')
  const [lwtPayload, setLwtPayloadState] = useState(request.lwtPayload ?? '')
  const [lwtQos, setLwtQosState] = useState(request.lwtQos ?? 0)
  const [lwtRetain, setLwtRetainState] = useState(request.lwtRetain === true)

  const setQos = useCallback((v: number): void => { setQosState(v); updateReactiveProperty(request, 'qos', v) }, [request])
  const setRetain = useCallback((v: boolean): void => { setRetainState(v); updateReactiveProperty(request, 'retain', v) }, [request])
  const setSubscribe = useCallback((v: boolean): void => { setSubscribeState(v); updateReactiveProperty(request, 'mqttSubscribe', v) }, [request])
  const setClientId = useCallback((v: string): void => { setClientIdState(v); updateReactiveProperty(request, 'clientId', v ? v : undefined) }, [request])
  const setUsername = useCallback((v: string): void => { setUsernameState(v); updateReactiveProperty(request, 'username', v ? v : undefined) }, [request])
  const setPassword = useCallback((v: string): void => { setPasswordState(v); updateReactiveProperty(request, 'password', v ? v : undefined) }, [request])
  const setKeepalive = useCallback((v: string): void => {
    setKeepaliveState(v)
    const n = Number.parseInt(v, 10)
    updateReactiveProperty(request, 'keepalive', v !== '' && Number.isFinite(n) ? n : undefined)
  }, [request])
  const setLwtTopic = useCallback((v: string): void => { setLwtTopicState(v); updateReactiveProperty(request, 'lwtTopic', v ? v : undefined) }, [request])
  const setLwtPayload = useCallback((v: string): void => { setLwtPayloadState(v); updateReactiveProperty(request, 'lwtPayload', v ? v : undefined) }, [request])
  const setLwtQos = useCallback((v: number): void => { setLwtQosState(v); updateReactiveProperty(request, 'lwtQos', v) }, [request])
  const setLwtRetain = useCallback((v: boolean): void => { setLwtRetainState(v); updateReactiveProperty(request, 'lwtRetain', v) }, [request])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px', border: '1px solid var(--panel-border)', borderRadius: 3 }} data-testid="mqtt-options">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Field label={t('mqtt.qos')}>
          <SelectBox
            id={`mqtt-qos-${request.id}`}
            className=""
            options={QOS_OPTIONS}
            selected={qos}
            onDidSelect={(d: ISelectData) => { setQos(d.index) }}
            data-testid="mqtt-qos-select"
          />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <Toggle checked={retain} onChange={setRetain} aria-label={t('mqtt.retain')} data-testid="mqtt-retain-toggle" />
          {t('mqtt.retain')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <Toggle checked={subscribe} onChange={setSubscribe} aria-label={t('mqtt.subscribeOnConnect')} data-testid="mqtt-subscribe-toggle" />
          {t('mqtt.subscribeOnConnect')}
        </label>
      </div>

      <Field label={t('mqtt.clientId')}>
        <RestormVariableInputBox value={clientId} onChange={setClientId} variables={variables} helpers={helpers} placeholder={t('mqtt.clientIdPlaceholder')} data-testid="mqtt-clientid-input" />
      </Field>
      <Field label={t('mqtt.username')}>
        <RestormVariableInputBox value={username} onChange={setUsername} variables={variables} helpers={helpers} placeholder={t('mqtt.username')} data-testid="mqtt-username-input" />
      </Field>
      <Field label={t('mqtt.password')}>
        <RestormVariableInputBox value={password} onChange={setPassword} variables={variables} helpers={helpers} placeholder={t('mqtt.password')} data-testid="mqtt-password-input" />
      </Field>
      <Field label={t('mqtt.keepalive')}>
        <InputBox value={keepalive} onChange={setKeepalive} options={{ placeholder: '60' }} data-testid="mqtt-keepalive-input" />
      </Field>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2, paddingTop: 6, borderTop: '1px solid var(--panel-border)' }}>
        <span style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>{t('mqtt.lwt')}</span>
        <Field label={t('mqtt.topic')}>
          <RestormVariableInputBox value={lwtTopic} onChange={setLwtTopic} variables={variables} helpers={helpers} placeholder={t('mqtt.lwtTopicPlaceholder')} data-testid="mqtt-lwt-topic-input" />
        </Field>
        <Field label={t('mqtt.lwtPayload')}>
          <RestormVariableInputBox value={lwtPayload} onChange={setLwtPayload} variables={variables} helpers={helpers} placeholder={t('mqtt.lwtPayloadPlaceholder')} data-testid="mqtt-lwt-payload-input" />
        </Field>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Field label={t('mqtt.qos')}>
            <SelectBox
              id={`mqtt-lwt-qos-${request.id}`}
              className=""
              options={QOS_OPTIONS}
              selected={lwtQos}
              onDidSelect={(d: ISelectData) => { setLwtQos(d.index) }}
              data-testid="mqtt-lwt-qos-select"
            />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <Toggle checked={lwtRetain} onChange={setLwtRetain} aria-label={t('mqtt.retain')} data-testid="mqtt-lwt-retain-toggle" />
            {t('mqtt.retain')}
          </label>
        </div>
      </div>
    </div>
  )
}
