import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  InputBox,
  SelectBox,
  Toggle,
  CodeEditor,
  SplitView,
  Pane,
  ScrollableElement,
  ControlGroup,
  eventBus,
  logger,
  getContrastColor,
  type ISelectData,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { useEmitRequestExecution } from '../../services/requestExecutingStore'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type {
  KafkaRequest,
  KafkaMode,
  KafkaFromOffset,
  KafkaSaslMechanism,
  KeyValue,
  ResponseHistoryDetail
} from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { KafkaMessageItem } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { updateReactiveProperty } from './requestTabViewUtils'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../../shared/config/constants'
import './WebSocketChat.css'

export interface KafkaRequestTabViewProps {
  request: KafkaRequest
}

/** Pure parsers (module scope, no closure deps) for the numeric-ish text
 * inputs (partition / peek count / partition filter) — plain `InputBox`
 * fields, not `RestormVariableInputBox`, mirroring `MqttOptionsPanel.keepalive`. */
function parseIntOrUndefined(v: string): number | undefined {
  const n = Number.parseInt(v, 10)
  return v.trim() !== '' && Number.isFinite(n) ? n : undefined
}
function parsePartitionsFilter(v: string): number[] | undefined {
  const list = v.split(',').map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n))
  return list.length > 0 ? list : undefined
}

/** Plain snapshot of every Kafka field the tab view tracks, string-shaped for
 * the numeric-ish ones (mirrors the local `useState` shapes) so this same
 * builder serves both the reactive request (on mount) and live local state
 * (on every field change) without any component-scoped closure. */
interface KafkaFieldsSnapshot {
  url: string
  clientId: string
  mode: KafkaMode
  topic: string
  key: string
  value: string
  partition: string
  groupId: string
  fromOffset: KafkaFromOffset
  specificOffset: string
  partitionsFilter: string
  browsePeekCount: string
  saslMechanism: KafkaSaslMechanism
  saslUsername: string
  saslPassword: string
  tlsEnabled: boolean
  headers: KeyValue[]
}

/** Build the kafka-prefixed slice of `FullRequestData` — the shape
 * `KafkaExecutionService.resolveKafka` reads. */
function buildKafkaFullData(f: KafkaFieldsSnapshot): Record<string, unknown> {
  const partition = parseIntOrUndefined(f.partition)
  const partitions = parsePartitionsFilter(f.partitionsFilter)
  const browsePeekCount = parseIntOrUndefined(f.browsePeekCount)
  return {
    requestType: 'kafka',
    url: f.url,
    kafkaClientId: f.clientId,
    kafkaMode: f.mode,
    kafkaTopic: f.topic,
    ...(f.key ? { kafkaKey: f.key } : {}),
    kafkaValue: f.value,
    ...(partition !== undefined ? { kafkaPartition: partition } : {}),
    ...(f.groupId ? { kafkaGroupId: f.groupId } : {}),
    kafkaFromOffset: f.fromOffset,
    ...(f.specificOffset ? { kafkaSpecificOffset: f.specificOffset } : {}),
    ...(partitions !== undefined ? { kafkaPartitions: partitions } : {}),
    ...(browsePeekCount !== undefined ? { kafkaBrowsePeekCount: browsePeekCount } : {}),
    kafkaSaslMechanism: f.saslMechanism,
    ...(f.saslUsername ? { kafkaSaslUsername: f.saslUsername } : {}),
    ...(f.saslPassword ? { kafkaSaslPassword: f.saslPassword } : {}),
    ...(f.tlsEnabled ? { kafkaTlsEnabled: f.tlsEnabled } : {}),
    headers: toKeyValueDataShared(f.headers)
  }
}

/** Row label + control, evenly aligned — mirrors `MqttOptionsPanel`'s `Field`. */
const Field: React.FC<{ label: string; children: React.ReactNode; width?: number }> = ({ label, children, width = 96 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontSize: 12, width, flexShrink: 0, color: 'var(--foreground-muted)' }}>{label}</span>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
)

/** Local response shape covering all three Kafka lifecycles, close enough to
 * `KafkaProduceResult | KafkaBrowseResult | KafkaConsumeResult` for the
 * Infos/Response panes below (the panel never needs the discriminated union
 * itself, only the fields each mode fills in). */
interface KafkaLocalResponse {
  kafkaMode: KafkaMode
  success: boolean
  requestTopic: string
  requestUrl: string
  partition?: number | undefined
  offset?: string | undefined
  messages: KafkaMessageItem[]
  connected?: boolean | undefined
  error?: string | undefined
  timings: { startedAt: string; durationMs: number }
}

const SASL_OPTIONS: { text: KafkaSaslMechanism }[] = [
  { text: 'none' }, { text: 'plain' }, { text: 'scram-sha-256' }, { text: 'scram-sha-512' }
]
const OFFSET_OPTIONS: { text: KafkaFromOffset }[] = [{ text: 'earliest' }, { text: 'latest' }, { text: 'specific' }]

export const KafkaRequestTabView: React.FC<KafkaRequestTabViewProps> = ({ request }) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  const { selectedEnvId, environments, envColor, projectUuid, envIcon, envPaintColor } = useEnvironmentContext()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  // ---- Local state mirroring every KafkaRequest field --------------------
  const [url, setUrlState] = useState(request.url)
  const [clientId, setClientIdState] = useState(request.clientId)
  const [mode, setModeState] = useState<KafkaMode>(request.mode)
  const [topic, setTopicState] = useState(request.topic)
  const [key, setKeyState] = useState(request.key ?? '')
  const [value, setValueState] = useState(request.value)
  const [partition, setPartitionState] = useState(request.partition !== undefined ? String(request.partition) : '')
  const [groupId, setGroupIdState] = useState(request.groupId ?? '')
  const [fromOffset, setFromOffsetState] = useState<KafkaFromOffset>(request.fromOffset)
  const [specificOffset, setSpecificOffsetState] = useState(request.specificOffset ?? '')
  const [partitionsFilter, setPartitionsFilterState] = useState((request.partitions ?? []).join(','))
  const [browsePeekCount, setBrowsePeekCountState] = useState(request.browsePeekCount !== undefined ? String(request.browsePeekCount) : '')
  const [saslMechanism, setSaslMechanismState] = useState<KafkaSaslMechanism>(request.saslMechanism)
  const [saslUsername, setSaslUsernameState] = useState(request.saslUsername ?? '')
  const [saslPassword, setSaslPasswordState] = useState(request.saslPassword ?? '')
  const [tlsEnabled, setTlsEnabledState] = useState(request.tlsEnabled === true)

  // ---- Execution state -----------------------------------------------------
  const [produceResponse, setProduceResponse] = useState<KafkaLocalResponse | null>(null)
  const [browseResponse, setBrowseResponse] = useState<KafkaLocalResponse | null>(null)
  const [isConsuming, setIsConsuming] = useState(false)
  // A consume is long-lived and doesn't flow through the base view's
  // isLoading (that would fake the 'Sending…' placeholder) — feed the shared
  // request-activity store directly so sidebar + tab badges beam while the
  // consumer is live. A Kafka request has a single mode, so this never
  // overlaps the produce/browse signal the base view emits.
  useEmitRequestExecution(request.id, isConsuming)
  const [consumeMessages, setConsumeMessages] = useState<KafkaMessageItem[]>([])
  const [consumeError, setConsumeError] = useState<string | undefined>(undefined)
  const [isProducing, setIsProducing] = useState(false)
  const [isBrowsing, setIsBrowsing] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const [panelCollapsed, setPanelCollapsed] = useState<{ value: boolean; headers: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      value: typeof seed['value'] === 'boolean' ? seed['value'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { value: arr[0] ?? false, headers: arr[1] ?? false }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'value', next.value)
      setRequestPanelCollapsed(projectUuid, request.id, 'headers', next.headers)
    }
  }, [projectUuid, request.id])

  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())
  const [transportEpoch, setTransportEpoch] = useState(0)
  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  // Environment variables for scalar {{...}} fields so their autocomplete
  // offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setClientIdState(request.clientId)
    setModeState(request.mode)
    setTopicState(request.topic)
    setKeyState(request.key ?? '')
    setValueState(request.value)
    setPartitionState(request.partition !== undefined ? String(request.partition) : '')
    setGroupIdState(request.groupId ?? '')
    setFromOffsetState(request.fromOffset)
    setSpecificOffsetState(request.specificOffset ?? '')
    setPartitionsFilterState((request.partitions ?? []).join(','))
    setBrowsePeekCountState(request.browsePeekCount !== undefined ? String(request.browsePeekCount) : '')
    setSaslMechanismState(request.saslMechanism)
    setSaslUsernameState(request.saslUsername ?? '')
    setSaslPasswordState(request.saslPassword ?? '')
    setTlsEnabledState(request.tlsEnabled === true)
    setProduceResponse(null)
    setBrowseResponse(null)
    setConsumeMessages([])
    setConsumeError(undefined)
    setIsConsuming(false)
  }, [request])
  useRequestReset(request, handleRequestReset)

  const requestRef = useRef(request)
  const selectedEnvIdRef = useRef(selectedEnvId)
  useEffect(() => { requestRef.current = request }, [request])
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])

  const handleTransportReplaced = useCallback(() => {
    handleRequestReset()
    setTransportEpoch((n) => n + 1)
  }, [handleRequestReset])
  useTransportReplaced(request, handleTransportReplaced)

  // Register with ContextService on mount, unregister on unmount. Reads the
  // reactive request directly (via `requestRef`) rather than the tracked
  // local state — this effect only re-runs on id/environments change, so it
  // must not depend on every field's state setter.
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const r = requestRef.current
    logger.debug('[KafkaRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueDataShared(r.headers)
    })
    void window.restorm?.context.updateFullRequestData(requestId, buildKafkaFullData({
      url: r.url, clientId: r.clientId, mode: r.mode, topic: r.topic, key: r.key ?? '', value: r.value,
      partition: r.partition !== undefined ? String(r.partition) : '', groupId: r.groupId ?? '',
      fromOffset: r.fromOffset, specificOffset: r.specificOffset ?? '', partitionsFilter: (r.partitions ?? []).join(','),
      browsePeekCount: r.browsePeekCount !== undefined ? String(r.browsePeekCount) : '', saslMechanism: r.saslMechanism,
      saslUsername: r.saslUsername ?? '', saslPassword: r.saslPassword ?? '', tlsEnabled: r.tlsEnabled === true, headers: r.headers
    }), sourceIdRef.current)

    const unsubUrl = window.restorm?.context.onUrlResolved((result) => {
      if (result.requestId === requestId) setResolvedUrl(result.resolvedUrl)
    })
    const unsubSnippets = window.restorm?.context.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) setBackendCodeSnippets(result.markdown)
    })
    void window.restorm?.context.getResolvedUrl(requestId).then((result) => { if (result) setResolvedUrl(result.resolvedUrl) })
    void window.restorm?.context.getCodeSnippets(requestId).then((result) => { if (result) setBackendCodeSnippets(result.markdown) })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[KafkaRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl?.()
      unsubSnippets?.()
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Push every field change to ContextService for Handlebars re-resolution.
  useEffect(() => {
    void window.restorm?.context.updateFullRequestData(request.id, buildKafkaFullData({
      url, clientId, mode, topic, key, value, partition, groupId, fromOffset, specificOffset,
      partitionsFilter, browsePeekCount, saslMechanism, saslUsername, saslPassword, tlsEnabled,
      headers: request.headers
    }), sourceIdRef.current)
  }, [request.id, request.headers, url, clientId, mode, topic, key, value, partition, groupId, fromOffset, specificOffset, partitionsFilter, browsePeekCount, saslMechanism, saslUsername, saslPassword, tlsEnabled])

  // Live consume stream for this request.
  useEffect(() => {
    const requestId = request.id
    const unsubMsg = window.restorm?.kafka.onMessage(({ requestId: rid, message: m }) => {
      if (rid !== requestId) return
      setConsumeMessages((prev) => [...prev, m])
    })
    const unsubProg = window.restorm?.kafka.onProgress(({ requestId: rid, status, error }) => {
      if (rid !== requestId) return
      if (status === 'started') { setConsumeMessages([]); setConsumeError(undefined) }
      if (status === 'error') { setConsumeError(error ?? t('kafka.consumeError')) }
      if (status === 'completed' || status === 'cancelled' || status === 'error') {
        setIsConsuming(false)
        setHistoryRefreshKey((k) => k + 1)
      }
    })
    return () => { unsubMsg?.(); unsubProg?.() }
  }, [request.id, t])

  // ---- Sync state changes to the reactive request object ------------------
  const setUrl = useCallback((v: string): void => { setUrlState(v); updateReactiveProperty(request, 'url', v) }, [request])
  const setClientId = useCallback((v: string): void => { setClientIdState(v); updateReactiveProperty(request, 'clientId', v) }, [request])
  const setMode = useCallback((v: KafkaMode): void => { setModeState(v); updateReactiveProperty(request, 'mode', v) }, [request])
  const setTopic = useCallback((v: string): void => { setTopicState(v); updateReactiveProperty(request, 'topic', v) }, [request])
  const setKey = useCallback((v: string): void => { setKeyState(v); updateReactiveProperty(request, 'key', v ? v : undefined) }, [request])
  const setValue = useCallback((v: string): void => { setValueState(v); updateReactiveProperty(request, 'value', v) }, [request])
  const setPartition = useCallback((v: string): void => { setPartitionState(v); updateReactiveProperty(request, 'partition', parseIntOrUndefined(v)) }, [request])
  const setGroupId = useCallback((v: string): void => { setGroupIdState(v); updateReactiveProperty(request, 'groupId', v ? v : undefined) }, [request])
  const setFromOffset = useCallback((v: KafkaFromOffset): void => { setFromOffsetState(v); updateReactiveProperty(request, 'fromOffset', v) }, [request])
  const setSpecificOffset = useCallback((v: string): void => { setSpecificOffsetState(v); updateReactiveProperty(request, 'specificOffset', v ? v : undefined) }, [request])
  const setPartitionsFilter = useCallback((v: string): void => { setPartitionsFilterState(v); updateReactiveProperty(request, 'partitions', parsePartitionsFilter(v)) }, [request])
  const setBrowsePeekCount = useCallback((v: string): void => { setBrowsePeekCountState(v); updateReactiveProperty(request, 'browsePeekCount', parseIntOrUndefined(v)) }, [request])
  const setSaslMechanism = useCallback((v: KafkaSaslMechanism): void => { setSaslMechanismState(v); updateReactiveProperty(request, 'saslMechanism', v) }, [request])
  const setSaslUsername = useCallback((v: string): void => { setSaslUsernameState(v); updateReactiveProperty(request, 'saslUsername', v ? v : undefined) }, [request])
  const setSaslPassword = useCallback((v: string): void => { setSaslPasswordState(v); updateReactiveProperty(request, 'saslPassword', v ? v : undefined) }, [request])
  const setTlsEnabled = useCallback((v: boolean): void => { setTlsEnabledState(v); updateReactiveProperty(request, 'tlsEnabled', v) }, [request])

  const handleHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'headers', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers',
      rows.map((r) => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
      sourceIdRef.current
    )
  }, [request])

  // ---- Actions --------------------------------------------------------------
  const handleProduce = (): void => {
    if (isProducing) return
    setIsProducing(true)
    setProduceResponse(null)
    window.restorm?.kafka.produce({ requestId: request.id, timeout: DEFAULT_REQUEST_TIMEOUT_MS })
      .then((res) => {
        setProduceResponse({
          kafkaMode: 'produce', success: res.success, requestTopic: res.requestTopic, requestUrl: res.requestUrl,
          partition: res.partition, offset: res.offset, messages: [], error: res.error, timings: res.timings
        })
        setHistoryRefreshKey((k) => k + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
      })
      .catch((err: unknown) => { logger.error('Kafka produce failed', { error: String(err) }) })
      .finally(() => { setIsProducing(false) })
  }

  const handleBrowse = (): void => {
    if (isBrowsing) return
    setIsBrowsing(true)
    setBrowseResponse(null)
    window.restorm?.kafka.browse({ requestId: request.id, timeout: DEFAULT_REQUEST_TIMEOUT_MS })
      .then((res) => {
        setBrowseResponse({
          kafkaMode: 'browse', success: res.success, requestTopic: res.requestTopic, requestUrl: res.requestUrl,
          messages: res.messages, error: res.error, timings: res.timings
        })
        setHistoryRefreshKey((k) => k + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
      })
      .catch((err: unknown) => { logger.error('Kafka browse failed', { error: String(err) }) })
      .finally(() => { setIsBrowsing(false) })
  }

  const handleConsumeStart = (): void => {
    if (isConsuming) return
    setConsumeMessages([])
    setConsumeError(undefined)
    void window.restorm?.kafka.consumeStart(request.id).then((res) => {
      if (res.started) setIsConsuming(true)
    })
  }
  const handleConsumeStop = (): void => {
    void window.restorm?.kafka.cancel(request.id)
  }

  const handleCloseHistoryModal = useCallback(() => { setHistoryModalOpen(false) }, [])
  useEffect(() => {
    const requestId = request.id
    const subscription = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_OPEN,
      (payload) => { if (payload.requestId === requestId) setHistoryModalOpen(true) }
    )
    return () => { subscription.unsubscribe() }
  }, [request.id])

  // ---- Mode selector ----------------------------------------------------
  const modeOptions = useMemo<{ value: KafkaMode; label: string }[]>(() => [
    { value: 'produce', label: t('kafka.mode.produce') },
    { value: 'consume', label: t('kafka.mode.consume') },
    { value: 'browse', label: t('kafka.mode.browse') }
  ], [t])
  const modeIndex = Math.max(0, modeOptions.findIndex((o) => o.value === mode))

  // ---- Auth section (shared by all three modes) --------------------------
  const authSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 4, border: '1px solid var(--panel-border)', borderRadius: 3 }} data-testid="kafka-auth-section">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Field label={t('kafka.auth.mechanism')} width={70}>
          <SelectBox
            id={`kafka-sasl-${request.id}`}
            className=""
            options={SASL_OPTIONS}
            selected={Math.max(0, SASL_OPTIONS.findIndex((o) => o.text === saslMechanism))}
            onDidSelect={(d: ISelectData) => { setSaslMechanism((SASL_OPTIONS[d.index]?.text ?? 'none')) }}
            data-testid="kafka-sasl-select"
          />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <Toggle checked={tlsEnabled} onChange={setTlsEnabled} aria-label={t('kafka.auth.tls')} data-testid="kafka-tls-toggle" />
          {t('kafka.auth.tls')}
        </label>
      </div>
      {saslMechanism !== 'none' && (
        <>
          <Field label={t('kafka.auth.username')}>
            <RestormVariableInputBox value={saslUsername} onChange={setSaslUsername} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('kafka.auth.username')} data-testid="kafka-sasl-username-input" />
          </Field>
          <Field label={t('kafka.auth.password')}>
            <RestormVariableInputBox value={saslPassword} onChange={setSaslPassword} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('kafka.auth.password')} data-testid="kafka-sasl-password-input" />
          </Field>
        </>
      )}
    </div>
  )

  // ---- Mode-specific request content --------------------------------------
  const produceContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }} data-testid="kafka-produce-split-view" onCollapsedChange={handlePanelCollapsedChange}>
      <Pane title={t('kafka.value')} initialSize={0.7} minSize={150} collapsed={panelCollapsed.value} data-testid="kafka-value-pane">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label={t('kafka.key')}>
                <RestormVariableInputBox value={key} onChange={setKey} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('kafka.keyPlaceholder')} data-testid="kafka-key-input" />
              </Field>
            </div>
            <div style={{ width: 120 }}>
              <Field label={t('kafka.partition')} width={64}>
                <InputBox value={partition} onChange={setPartition} options={{ placeholder: t('kafka.partitionPlaceholder') }} data-testid="kafka-partition-input" />
              </Field>
            </div>
          </div>
          <div style={{ flex: 1, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
            <CodeEditor
              key={`value-${transportEpoch}`}
              height="100%"
              language="json"
              value={value}
              onChange={(v) => { setValue(v ?? '') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
              data-testid="kafka-value-editor"
            />
          </div>
        </div>
      </Pane>
      <Pane
        title={t('kafka.headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={panelCollapsed.headers}
        data-testid="kafka-headers-pane"
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary small icon="add"
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => { if (collapsed) toggle(); headersRef.current?.addRow() }}
            data-testid="kafka-add-header-button"
          />
        )}
      >
        <RestormKeyValueTable
          key={`headers-${transportEpoch}`}
          ref={headersRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={handleHeadersChange}
          persistenceId={`kafka-headers:${request.id}`}
          data-testid="kafka-headers-table"
        />
      </Pane>
    </SplitView>
  )

  const consumeContent = (
    <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden' }} style={{ width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }} data-testid="kafka-consume-fields">
        <Field label={t('kafka.groupId')}>
          <RestormVariableInputBox value={groupId} onChange={setGroupId} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('kafka.groupIdPlaceholder')} data-testid="kafka-groupid-input" />
        </Field>
        <Field label={t('kafka.fromOffsetLabel')} width={110}>
          <SelectBox
            id={`kafka-consume-offset-${request.id}`}
            className=""
            options={OFFSET_OPTIONS}
            selected={Math.max(0, OFFSET_OPTIONS.findIndex((o) => o.text === fromOffset))}
            onDidSelect={(d: ISelectData) => { setFromOffset(OFFSET_OPTIONS[d.index]?.text ?? 'latest') }}
            data-testid="kafka-consume-fromoffset-select"
          />
        </Field>
        {fromOffset === 'specific' && (
          <Field label={t('kafka.specificOffset')}>
            <InputBox value={specificOffset} onChange={setSpecificOffset} options={{ placeholder: '0' }} data-testid="kafka-consume-specificoffset-input" />
          </Field>
        )}
        <Field label={t('kafka.partitions')}>
          <InputBox value={partitionsFilter} onChange={setPartitionsFilter} options={{ placeholder: t('kafka.partitionsPlaceholder') }} data-testid="kafka-consume-partitions-input" />
        </Field>
      </div>
    </ScrollableElement>
  )

  const browseContent = (
    <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden' }} style={{ width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }} data-testid="kafka-browse-fields">
        <Field label={t('kafka.partition')}>
          <InputBox value={partition} onChange={setPartition} options={{ placeholder: '0' }} data-testid="kafka-browse-partition-input" />
        </Field>
        <Field label={t('kafka.fromOffsetLabel')} width={110}>
          <SelectBox
            id={`kafka-browse-offset-${request.id}`}
            className=""
            options={OFFSET_OPTIONS}
            selected={Math.max(0, OFFSET_OPTIONS.findIndex((o) => o.text === fromOffset))}
            onDidSelect={(d: ISelectData) => { setFromOffset(OFFSET_OPTIONS[d.index]?.text ?? 'latest') }}
            data-testid="kafka-browse-fromoffset-select"
          />
        </Field>
        {fromOffset === 'specific' && (
          <Field label={t('kafka.specificOffset')}>
            <InputBox value={specificOffset} onChange={setSpecificOffset} options={{ placeholder: '0' }} data-testid="kafka-browse-specificoffset-input" />
          </Field>
        )}
        <Field label={t('kafka.peekCount')}>
          <InputBox value={browsePeekCount} onChange={setBrowsePeekCount} options={{ placeholder: '10' }} data-testid="kafka-browse-peekcount-input" />
        </Field>
      </div>
    </ScrollableElement>
  )

  const requestContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: 4 }} data-testid="kafka-request-content">
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label={t('kafka.topic')}>
            <RestormVariableInputBox value={topic} onChange={setTopic} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('kafka.topicPlaceholder')} data-testid="kafka-topic-input" />
          </Field>
        </div>
      </div>
      {authSection}
      <div style={{ flex: 1, minHeight: 0 }}>
        {mode === 'produce' ? produceContent : mode === 'consume' ? consumeContent : browseContent}
      </div>
    </div>
  )

  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const renderMessages = useCallback((messages: KafkaMessageItem[]): React.ReactNode => {
    if (messages.length === 0) {
      return <div className="ws-chat-empty" data-testid="kafka-no-messages">{t('kafka.noMessages')}</div>
    }
    return (
      <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }} style={{ flex: 1, minHeight: 0 }}>
        <div className="ws-chat">
          {messages.map((m, i) => (
            <div
              key={i}
              className="ws-chat-bubble received"
              data-testid={`response-stream-frame-${i}`}
              data-direction="received"
            >
              <span className="ws-chat-event">
                <span style={{ marginRight: 8 }}>{t('kafka.partition')}: {m.partition}</span>
                <span style={{ marginRight: 8 }}>{t('kafka.offset')}: {m.offset}</span>
                {m.key && <span>{t('kafka.key')}: {m.key}</span>}
              </span>
              {m.value}
            </div>
          ))}
        </div>
      </ScrollableElement>
    )
  }, [t])

  const buildKafkaResponseView = useCallback((resp: KafkaLocalResponse | null) => {
    if (!resp) return { infosContent: null, responseContent: null, jsonData: undefined }
    const infosContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.success ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.success ? 'OK' : 'Failed'}
          </span>
        </div>
        {resp.timings.durationMs > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
            <span>{resp.timings.durationMs}ms</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>{t('kafka.topic')}:</span>
          <span>{resp.requestTopic || '-'}</span>
        </div>
        {resp.kafkaMode === 'produce' && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontWeight: 600, minWidth: 100 }}>{t('kafka.partition')}:</span>
              <span>{resp.partition ?? '-'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontWeight: 600, minWidth: 100 }}>{t('kafka.offset')}:</span>
              <span>{resp.offset ?? '-'}</span>
            </div>
          </>
        )}
        {resp.kafkaMode === 'consume' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
            <span>{resp.connected ? t('kafka.connected') : t('kafka.disconnected')}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>{t('kafka.messages')}:</span>
          <span>{resp.messages.length}</span>
        </div>
        {resp.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>{resp.error}</div>
          </div>
        )}
      </div>
    )
    return { infosContent, responseContent: renderMessages(resp.messages), jsonData: undefined }
  }, [t, renderMessages])

  const liveConsumeResponse = useMemo<KafkaLocalResponse | null>(() => {
    if (!isConsuming && consumeMessages.length === 0 && !consumeError) return null
    return {
      kafkaMode: 'consume', success: consumeError === undefined, requestTopic: topic, requestUrl: resolvedUrl || url,
      connected: isConsuming, messages: consumeMessages, error: consumeError, timings: { startedAt: '', durationMs: 0 }
    }
  }, [isConsuming, consumeMessages, consumeError, topic, resolvedUrl, url])

  const activeResponse = mode === 'produce' ? produceResponse : mode === 'browse' ? browseResponse : liveConsumeResponse
  const { infosContent, responseContent } = useMemo(() => buildKafkaResponseView(activeResponse), [buildKafkaResponseView, activeResponse])

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'kafka') return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    const r = detail.response
    const historyResponse: KafkaLocalResponse = {
      kafkaMode: r.kafkaMode, success: r.error === undefined, requestTopic: r.requestTopic, requestUrl: r.requestUrl,
      partition: r.producedPartition, offset: r.producedOffset,
      messages: (r.messages ?? []).map((m) => ({
        direction: m.direction, topic: m.topic, partition: m.partition, offset: m.offset,
        ...(m.key !== undefined ? { key: m.key } : {}),
        value: m.value,
        ...(m.headers ? { headers: Object.fromEntries(m.headers.map((h) => [h.key, h.value])) } : {}),
        timestamp: m.timestamp
      })),
      connected: r.connected, error: r.error, timings: r.timings
    }
    return buildKafkaResponseView(historyResponse)
  }, [buildKafkaResponseView])

  // ---- Primary action button, one per mode --------------------------------
  const actionButton = mode === 'produce' ? (
    <SendButtonEnvSwitcher>
      <BeamWrap active={isProducing} size={22} borderWidth={1.5}>
        <Button
          icon="send" onClick={handleProduce} disabled={isProducing}
          {...(sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
          options={{ title: t('kafka.produce'), ariaLabel: t('kafka.produce') }}
          data-testid="kafka-produce-button"
        />
      </BeamWrap>
    </SendButtonEnvSwitcher>
  ) : mode === 'browse' ? (
    <SendButtonEnvSwitcher>
      <BeamWrap active={isBrowsing} size={22} borderWidth={1.5}>
        <Button
          icon="search" onClick={handleBrowse} disabled={isBrowsing}
          {...(sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
          options={{ title: t('kafka.peek'), ariaLabel: t('kafka.peek') }}
          data-testid="kafka-browse-button"
        />
      </BeamWrap>
    </SendButtonEnvSwitcher>
  ) : (
    <BeamWrap active={isConsuming} size={22} borderWidth={1.5}>
      <Button
        icon={isConsuming ? 'debug-disconnect' : 'plug'}
        onClick={isConsuming ? handleConsumeStop : handleConsumeStart}
        {...(isConsuming ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
        options={{
          title: isConsuming ? t('kafka.stopConsuming') : t('kafka.startConsuming'),
          ariaLabel: isConsuming ? t('kafka.stopConsuming') : t('kafka.startConsuming')
        }}
        data-testid="kafka-consume-button"
      />
    </BeamWrap>
  )

  const urlSection = (
    <ControlGroup data-testid="kafka-url-section">
      <div style={{ width: 96 }}>
        <SelectBox
          id={`kafka-mode-${request.id}`}
          className=""
          options={modeOptions.map((o) => ({ text: o.value, label: o.label }))}
          selected={modeIndex}
          onDidSelect={(d: ISelectData) => { setMode(modeOptions[d.index]?.value ?? 'produce') }}
          data-testid="kafka-mode-select"
        />
      </div>
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={{ flex: 1, minWidth: 0 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url} onChange={setUrl} variables={envVariables} helpers={handlebarsHelpers}
            placeholder={t('kafka.brokersPlaceholder')} data-testid="kafka-url-input"
          />
        </div>
      </HeaderHoverTooltip>
      <div style={{ width: 140 }}>
        <RestormVariableInputBox
          value={clientId} onChange={setClientId} variables={envVariables} helpers={handlebarsHelpers}
          placeholder={t('kafka.clientIdPlaceholder')} data-testid="kafka-clientid-input"
        />
      </div>
      {!inWorkbenchTab && actionButton}
    </ControlGroup>
  )

  // Fixed action bar, anchored top-right of the workbench tab. One disc per
  // mode: produce a record, browse a topic, or run a consumer.
  const actionToolbar = !inWorkbenchTab ? undefined : (
    <RequestActionToolbar>
      {mode === 'produce' ? (
        <RoundActionButton
          icon="send"
          onClick={handleProduce}
          disabled={isProducing}
          {...(envPaintColor ? { color: envPaintColor } : {})}
          {...(envIcon ? { envIcon } : {})}
          envSwitch
          beamActive={isProducing}
          ariaLabel={t('kafka.produce')}
          data-testid="kafka-produce-button"
        />
      ) : mode === 'browse' ? (
        <RoundActionButton
          icon="search"
          onClick={handleBrowse}
          disabled={isBrowsing}
          {...(envPaintColor ? { color: envPaintColor } : {})}
          {...(envIcon ? { envIcon } : {})}
          envSwitch
          beamActive={isBrowsing}
          ariaLabel={t('kafka.peek')}
          data-testid="kafka-browse-button"
        />
      ) : (
        <RoundActionButton
          icon={isConsuming ? 'debug-disconnect' : 'plug'}
          onClick={isConsuming ? handleConsumeStop : handleConsumeStart}
          tone={isConsuming ? 'stop' : 'run'}
          {...(isConsuming || !envPaintColor ? {} : { color: envPaintColor })}
          {...(isConsuming || !envIcon ? {} : { envIcon })}
          beamActive={isConsuming}
          ariaLabel={isConsuming ? t('kafka.stopConsuming') : t('kafka.startConsuming')}
          data-testid="kafka-consume-button"
        />
      )}
    </RequestActionToolbar>
  )

  return (
    <>
      <BaseRequestTabView
        requestId={request.id}
        urlSection={urlSection}
        {...(actionToolbar ? { actionToolbar } : {})}
        requestContent={requestContent}
        codeSnippetsContent={codeSnippetsContent}
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={isProducing || isBrowsing}
        showResponse={activeResponse !== null}
        infosContent={infosContent}
        responseContent={responseContent}
      />
      <ResponseHistoryModal
        isOpen={historyModalOpen}
        onClose={handleCloseHistoryModal}
        requestId={request.id}
        refreshKey={historyRefreshKey}
        buildResponseView={buildHistoryView}
      />
    </>
  )
}

export default KafkaRequestTabView
