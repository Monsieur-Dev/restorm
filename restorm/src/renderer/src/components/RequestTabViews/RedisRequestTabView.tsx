import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  SelectBox,
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
import type { RedisRequest, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { REDIS_COMMANDS } from '../../../../shared/models/types'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { RedisExecutionResult, RedisMessageItem } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { updateReactiveProperty } from './requestTabViewUtils'
import { DEFAULT_REDIS_TIMEOUT_MS } from '../../../../shared/config/constants'
import { getRedisCommandFields } from '../../../../shared/utils/redisCommandFields'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './WebSocketChat.css'
import { cloneForEventBus } from '../../utils/cloneForEventBus'

export interface RedisRequestTabViewProps {
  request: RedisRequest
}

/** One rendered command-mode REPL entry — a run + its (possibly still
 * in-flight) result, kept client-side so successive runs read like a
 * transcript instead of replacing each other. */
interface CommandHistoryEntry {
  command: string
  args: string[]
  reply?: string
  error?: string
  timestamp: string
}

export const RedisRequestTabView: React.FC<RedisRequestTabViewProps> = ({
  request
}) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  // See HTTPRequestTabView — `projectUuid` from the env context is
  // synchronously available, unlike `useFileService` which races the
  // `useState` lazy initializer.
  const { selectedEnvId, environments, envColor, projectUuid, envIcon, envPaintColor } = useEnvironmentContext()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  const actionButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [password, setPasswordState] = useState(request.password ?? '')
  const [mode, setModeState] = useState(request.mode)
  const [channelsText, setChannelsText] = useState(request.channels.join('\n'))
  const [command, setCommandState] = useState<string>(request.command ?? REDIS_COMMANDS[0])
  const [args, setArgsState] = useState<string[]>(request.args)
  const [freeformCommand, setFreeformCommandState] = useState(request.freeformCommand ?? '')

  // Subscribe mode: live frames for the current connection.
  const [liveMessages, setLiveMessages] = useState<RedisMessageItem[]>([])
  const [subscribeResult, setSubscribeResult] = useState<RedisExecutionResult | null>(null)
  const [isSubscribing, setIsSubscribing] = useState(false)

  // Command mode: a REPL-style transcript of runs (this tab session only —
  // the persisted history lives in ResponseHistoryService, same as every
  // other protocol).
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([])
  const [isRunningCommand, setIsRunningCommand] = useState(false)

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  // See HTTPRequestTabView for the contract.
  const [panelCollapsed, setPanelCollapsed] = useState<{ body: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return { body: typeof seed['body'] === 'boolean' ? seed['body'] : false }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { body: arr[0] ?? false }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'body', next.body)
    }
  }, [projectUuid, request.id])

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])

  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  // Bumped on a quick-config load (or MCP update_request) so the Monaco
  // channels editor remounts and re-reads its value from the now-mutated
  // request (it seeds local state from props once at mount).
  const [transportEpoch, setTransportEpoch] = useState(0)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setPasswordState(request.password ?? '')
    setModeState(request.mode)
    setChannelsText(request.channels.join('\n'))
    setCommandState(request.command ?? REDIS_COMMANDS[0])
    setArgsState(request.args)
    setFreeformCommandState(request.freeformCommand ?? '')
    setLiveMessages([])
    setSubscribeResult(null)
    setCommandHistory([])
  }, [request])
  useRequestReset(request, handleRequestReset)

  // Refs to capture initial values for registration (avoid re-running effect when these change)
  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])

  // Re-sync local state when a quick-config load (or MCP update_request)
  // replaces the transport. The state updates re-trigger the
  // updateFullRequestData useEffect below → Handlebars re-resolution.
  const handleTransportReplaced = useCallback(() => {
    const current = requestRef.current
    setUrlState(current.url)
    setPasswordState(current.password ?? '')
    setModeState(current.mode)
    setChannelsText(current.channels.join('\n'))
    setCommandState(current.command ?? REDIS_COMMANDS[0])
    setArgsState(current.args)
    setFreeformCommandState(current.freeformCommand ?? '')
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  const buildFullData = useCallback((values: {
    url: string
    password: string
    mode: 'subscribe' | 'command'
    channels: string[]
    command: string
    args: string[]
    freeformCommand: string
    // `values` carries fields read straight off the reactive request
    // (`args`, `channels`), which are Proxy-wrapped. The contextBridge
    // serializes into the preload's isolated world and REFUSES exotic
    // objects: it throws `An object could not be cloned.` BEFORE the
    // preload function runs, the exception escapes this effect, and React
    // tears the whole tree down — a blank window with no error shown.
    // Only plain data may cross.
  }): Record<string, unknown> => cloneForEventBus({
    url: values.url,
    requestType: 'redis',
    // Redis has no HTTP-style headers concept in its UI, but `headers` is a
    // required common field on `FullRequestData` — ContextService.updateFullRequestData
    // reads `data.headers.length` unconditionally, so an omitted field throws.
    headers: [],
    password: values.password ? values.password : undefined,
    redisMode: values.mode,
    channels: values.channels,
    command: values.command,
    args: values.args,
    freeformCommand: values.freeformCommand ? values.freeformCommand : undefined,
    body: { type: 'text', content: values.freeformCommand || `${values.command} ${values.args.join(' ')}`.trim() }
  }), [])

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    logger.debug('[RedisRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {})

    void window.restorm?.context.updateFullRequestData(requestId, buildFullData({
      url: currentRequest.url,
      password: currentRequest.password ?? '',
      mode: currentRequest.mode,
      channels: currentRequest.channels,
      command: currentRequest.command ?? '',
      args: currentRequest.args,
      freeformCommand: currentRequest.freeformCommand ?? ''
    }), sourceIdRef.current)

    const unsubUrl = window.restorm?.context.onUrlResolved((result) => {
      if (result.requestId === requestId) setResolvedUrl(result.resolvedUrl)
    })
    const unsubSnippets = window.restorm?.context.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) setBackendCodeSnippets(result.markdown)
    })

    void window.restorm?.context.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void window.restorm?.context.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[RedisRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl?.()
      unsubSnippets?.()
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, environments, buildFullData])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Notify ContextService when any resolvable field changes.
  const channels = useMemo(
    () => channelsText.split('\n').map((c) => c.trim()).filter((c) => c.length > 0),
    [channelsText]
  )

  useEffect(() => {
    void window.restorm?.context.updateFullRequestData(request.id, buildFullData({
      url, password, mode, channels, command, args, freeformCommand
    }), sourceIdRef.current)
  }, [request.id, url, password, mode, channels, command, args, freeformCommand, buildFullData])

  // Live message stream for an open subscription.
  useEffect(() => {
    const requestId = request.id
    const unsubMsg = window.restorm?.redis.onMessage(({ requestId: rid, message }) => {
      if (rid !== requestId) return
      setLiveMessages((prev) => [...prev, message])
    })
    const unsubProg = window.restorm?.redis.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') setLiveMessages([])
      if (status === 'completed' || status === 'cancelled' || status === 'error') {
        setHistoryRefreshKey((k) => k + 1)
      }
    })
    return () => { unsubMsg?.(); unsubProg?.() }
  }, [request.id])

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setPassword = useCallback((value: string): void => {
    setPasswordState(value)
    updateReactiveProperty(request, 'password', value ? value : undefined)
  }, [request])
  const setMode = useCallback((value: 'subscribe' | 'command'): void => {
    setModeState(value)
    updateReactiveProperty(request, 'mode', value)
  }, [request])
  const setChannels = useCallback((value: string): void => {
    setChannelsText(value)
    updateReactiveProperty(request, 'channels', value.split('\n').map((c) => c.trim()).filter((c) => c.length > 0))
  }, [request])
  const setCommand = useCallback((value: string): void => {
    setCommandState(value)
    updateReactiveProperty(request, 'command', value as RedisRequest['command'])
  }, [request])
  // Structured per-argument editing: each field writes its own `args` slot
  // directly (no space-join/split round trip), so a value carrying a space
  // is preserved verbatim.
  const setArgAt = useCallback((index: number, value: string): void => {
    const next = [...args]
    while (next.length <= index) next.push('')
    next[index] = value
    setArgsState(next)
    updateReactiveProperty(request, 'args', next)
  }, [args, request])
  const addArg = useCallback((): void => {
    const next = [...args, '']
    setArgsState(next)
    updateReactiveProperty(request, 'args', next)
  }, [args, request])
  const removeArgAt = useCallback((index: number): void => {
    const next = args.filter((_, i) => i !== index)
    setArgsState(next)
    updateReactiveProperty(request, 'args', next)
  }, [args, request])
  const setFreeformCommand = useCallback((value: string): void => {
    setFreeformCommandState(value)
    updateReactiveProperty(request, 'freeformCommand', value ? value : undefined)
  }, [request])

  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  // Environment variables for scalar {{...}} connection fields so their
  // autocomplete offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  // SUBSCRIBE mode: open the connection and listen. Resolves once the
  // session ends (user unsubscribe, or the server drops it).
  const handleSubscribe = (): void => {
    if (isSubscribing) return
    setLiveMessages([])
    setSubscribeResult(null)
    setIsSubscribing(true)

    window.restorm?.redis.subscribe({
      requestId: request.id,
      timeout: DEFAULT_REDIS_TIMEOUT_MS,
      ...(requestPath ? { requestPath } : {})
    } as never)
      .then((res: RedisExecutionResult) => {
        setSubscribeResult(res)
        setIsSubscribing(false)
        setHistoryRefreshKey((k) => k + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('Redis subscription closed', { url: res.requestUrl, connected: res.connected })
      })
      .catch((err: unknown) => {
        setIsSubscribing(false)
        logger.error('Redis subscription failed', { error: String(err) })
      })
  }

  const handleUnsubscribe = (): void => {
    void window.restorm?.redis.disconnect(request.id)
  }

  // COMMAND mode: run one command on a fresh client, then disconnect.
  const handleRunCommand = (): void => {
    if (isRunningCommand) return
    setIsRunningCommand(true)

    window.restorm?.redis.command({
      requestId: request.id,
      timeout: DEFAULT_REDIS_TIMEOUT_MS,
      ...(requestPath ? { requestPath } : {})
    } as never)
      .then((res: RedisExecutionResult) => {
        setCommandHistory((prev) => [...prev, {
          command: res.command ?? command,
          args: res.args ?? args,
          ...(res.reply !== undefined ? { reply: res.reply } : {}),
          ...(res.error ? { error: res.error } : {}),
          timestamp: res.timings.startedAt
        }])
        setHistoryRefreshKey((k) => k + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
      })
      .catch((err: unknown) => {
        logger.error('Redis command failed', { error: String(err) })
      })
      .finally(() => { setIsRunningCommand(false) })
  }

  const handleRun = mode === 'subscribe' ? handleSubscribe : handleRunCommand
  const isRunning = mode === 'subscribe' ? isSubscribing : isRunningCommand
  // Publish the activity into the shared request-activity store so the
  // sidebar and tab badges beam in sync with the run button.
  useEmitRequestExecution(request.id, isRunning)

  // Command-aware field layout for the selected command — fixed positional
  // fields (e.g. SET -> key + value) plus an optional repeatable tail for
  // variable-arity commands. Falls back to a generic one-field-per-argument
  // list for commands with no dedicated layout (see `redisCommandFields.ts`).
  const fieldsSpec = useMemo(() => getRedisCommandFields(command), [command])

  // Request content: mode-specific pane (channels for subscribe, command
  // palette + args + freeform override for command).
  const requestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="redis-request-split-view"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={mode === 'subscribe' ? t('redis.tabs.channels') : t('redis.tabs.command')} initialSize={1} minSize={150} collapsed={panelCollapsed.body} data-testid="redis-body-pane">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mode === 'subscribe' ? (
            <div style={{ flex: 1, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
              <CodeEditor
                key={`channels-${transportEpoch}`}
                height="100%"
                language="plaintext"
                value={channelsText}
                onChange={(v) => { setChannels(v ?? '') }}
                options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true, lineNumbers: 'off' }}
                data-testid="redis-channels-editor"
              />
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
                <span style={{ fontSize: 12, minWidth: 70 }}>{t('redis.command')}:</span>
                <div style={{ width: 140 }}>
                  <SelectBox
                    id={`redis-command-select-${request.id}`}
                    className=""
                    options={REDIS_COMMANDS.map((c) => ({ text: c }))}
                    selected={Math.max(0, REDIS_COMMANDS.indexOf(command as (typeof REDIS_COMMANDS)[number]))}
                    onDidSelect={(d: ISelectData): void => { setCommand(REDIS_COMMANDS[d.index] ?? REDIS_COMMANDS[0]) }}
                    data-testid="redis-command-select"
                  />
                </div>
              </div>
              {fieldsSpec.fixed.map((field, i) => (
                <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
                  <span style={{ fontSize: 12, minWidth: 70 }}>{t(field.labelKey)}:</span>
                  <div style={{ flex: 1 }}>
                    <RestormVariableInputBox
                      value={args[i] ?? ''}
                      onChange={(v) => { setArgAt(i, v) }}
                      variables={emptyVariables}
                      helpers={handlebarsHelpers}
                      data-testid={`redis-arg-${field.key}-input`}
                    />
                  </div>
                </div>
              ))}
              {fieldsSpec.repeatable && (
                <>
                  {args.slice(fieldsSpec.fixed.length).map((value, idx) => {
                    const i = fieldsSpec.fixed.length + idx
                    const repeatableLabelKey = fieldsSpec.repeatable?.labelKey ?? 'redis.fields.argument'
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
                        <span style={{ fontSize: 12, minWidth: 70 }}>{t(repeatableLabelKey)} {idx + 1}:</span>
                        <div style={{ flex: 1 }}>
                          <RestormVariableInputBox
                            value={value}
                            onChange={(v) => { setArgAt(i, v) }}
                            variables={emptyVariables}
                            helpers={handlebarsHelpers}
                            data-testid={`redis-arg-repeatable-${idx}-input`}
                          />
                        </div>
                        <HeaderHoverTooltip label={t('redis.removeArgument')}>
                          <Button
                            secondary
                            small
                            icon="trash"
                            onClick={() => { removeArgAt(i) }}
                            options={{ ariaLabel: t('redis.removeArgument') }}
                            data-testid={`redis-arg-remove-${idx}`}
                          />
                        </HeaderHoverTooltip>
                      </div>
                    )
                  })}
                  <div style={{ padding: '0 4px' }}>
                    <Button secondary icon="add" onClick={addArg} data-testid="redis-arg-add-button">
                      {t('redis.addArgument')}
                    </Button>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
                <span style={{ fontSize: 12, minWidth: 70 }}>{t('redis.freeform')}:</span>
                <div style={{ flex: 1 }}>
                  <RestormVariableInputBox
                    value={freeformCommand}
                    onChange={setFreeformCommand}
                    variables={emptyVariables}
                    helpers={handlebarsHelpers}
                    placeholder={t('redis.freeformPlaceholder')}
                    data-testid="redis-freeform-input"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Pane>
    </SplitView>
  )

  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  // Subscribe mode: a stream of received frames, one bubble per message.
  const renderStreamFrames = useCallback((messages: RedisMessageItem[]): React.ReactNode => {
    if (messages.length === 0) {
      return <div className="ws-chat-empty">{t('redis.noMessages')}</div>
    }
    return (
      <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }} style={{ flex: 1, minHeight: 0 }}>
        <div className="ws-chat">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`ws-chat-bubble ${m.direction === 'sent' ? 'sent' : 'received'}`}
              data-testid={`response-stream-frame-${i}`}
              data-direction={m.direction}
            >
              {m.channel && <span className="ws-chat-event">{m.channel}</span>}
              {m.data}
            </div>
          ))}
        </div>
      </ScrollableElement>
    )
  }, [t])

  // Command mode: a REPL-style transcript — one bubble per run.
  const renderCommandHistory = useCallback((entries: CommandHistoryEntry[]): React.ReactNode => {
    if (entries.length === 0) {
      return <div className="ws-chat-empty">{t('redis.noCommandsYet')}</div>
    }
    return (
      <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }} style={{ flex: 1, minHeight: 0 }}>
        <div className="ws-chat">
          {entries.map((entry, i) => (
            <React.Fragment key={i}>
              <div
                className="ws-chat-bubble sent"
                data-testid={`response-stream-frame-${i}`}
                data-direction="sent"
                style={{ fontFamily: 'var(--monospace-font-family, monospace)' }}
              >
                {entry.command} {entry.args.join(' ')}
              </div>
              <div
                className="ws-chat-bubble received"
                data-testid={`response-stream-frame-${i}-reply`}
                data-direction="received"
                style={entry.error ? { color: 'var(--testing-iconFailed)' } : undefined}
              >
                {entry.error ?? entry.reply ?? '(nil)'}
              </div>
            </React.Fragment>
          ))}
        </div>
      </ScrollableElement>
    )
  }, [t])

  const buildInfosContent = useCallback((meta: {
    mode: 'subscribe' | 'command'
    connected?: boolean | undefined
    durationMs?: number | undefined
    channels?: string[] | undefined
    command?: string | undefined
    error?: string | undefined
  }): React.ReactNode => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      {meta.mode === 'subscribe' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: meta.connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {meta.connected ? t('redis.connected') : t('redis.disconnected')}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Command:</span>
          <span>{meta.command ?? '-'}</span>
        </div>
      )}
      {meta.durationMs !== undefined && meta.durationMs > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span>{meta.durationMs}ms</span>
        </div>
      )}
      {meta.channels && meta.channels.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Channels:</span>
          <span>{meta.channels.join(', ')}</span>
        </div>
      )}
      {meta.error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
          <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>{meta.error}</div>
        </div>
      )}
    </div>
  ), [t])

  // Live view for subscribe mode: prefer streaming frames, fall back to the
  // resolved (terminal) result.
  const liveSubscribeInfos = useMemo(() => buildInfosContent({
    mode: 'subscribe',
    connected: isSubscribing || (subscribeResult?.connected ?? false),
    durationMs: subscribeResult?.timings.durationMs,
    channels,
    ...(subscribeResult?.error ? { error: subscribeResult.error } : {})
  }), [buildInfosContent, isSubscribing, subscribeResult, channels])

  const commandInfos = useMemo(() => {
    const last = commandHistory[commandHistory.length - 1]
    return buildInfosContent({
      mode: 'command',
      command: last?.command,
      ...(last?.error ? { error: last.error } : {})
    })
  }, [buildInfosContent, commandHistory])

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'redis') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const resp = detail.response
    if (resp.mode === 'subscribe') {
      return {
        infosContent: buildInfosContent({
          mode: 'subscribe',
          connected: resp.connected,
          durationMs: resp.timings.durationMs,
          channels: resp.channels,
          ...(resp.error ? { error: resp.error } : {})
        }),
        responseContent: renderStreamFrames((resp.messages ?? []).map((m) => ({ direction: m.direction, channel: m.channel, data: m.data, timestamp: m.timestamp }))),
        jsonData: undefined
      }
    }
    return {
      infosContent: buildInfosContent({
        mode: 'command',
        command: resp.command,
        durationMs: resp.timings.durationMs,
        ...(resp.error ? { error: resp.error } : {})
      }),
      responseContent: renderCommandHistory([{
        command: resp.command ?? '',
        args: resp.args ?? [],
        ...(resp.reply !== undefined ? { reply: resp.reply } : {}),
        ...(resp.error ? { error: resp.error } : {}),
        timestamp: resp.timings.startedAt
      }]),
      jsonData: undefined
    }
  }, [buildInfosContent, renderStreamFrames, renderCommandHistory])

  // Run/Subscribe toggle button.
  const runButton = (
    <BeamWrap active={isRunning} size={22} borderWidth={1.5}>
      <Button
        icon={mode === 'subscribe' ? (isSubscribing ? 'debug-disconnect' : 'plug') : 'run'}
        onClick={mode === 'subscribe' ? (isSubscribing ? handleUnsubscribe : handleSubscribe) : handleRun}
        disabled={mode === 'command' && isRunningCommand}
        {...(mode === 'subscribe' && isSubscribing ? { emphasis: 0 } : (actionButtonStyle ? { style: actionButtonStyle } : { emphasis: 1 }))}
        options={{
          title: mode === 'subscribe' ? (isSubscribing ? t('redis.unsubscribe') : t('redis.subscribe')) : t('redis.run'),
          ariaLabel: mode === 'subscribe' ? (isSubscribing ? t('redis.unsubscribe') : t('redis.subscribe')) : t('redis.run')
        }}
        data-testid="redis-run-button"
      />
    </BeamWrap>
  )

  const urlSection = (
    <ControlGroup data-testid="redis-url-section">
      <div style={{ width: 130, minWidth: 100 }} data-testid="redis-mode-select">
        <SelectBox
          id={`redis-mode-select-${request.id}`}
          className=""
          options={[{ text: t('redis.subscribeMode') }, { text: t('redis.commandMode') }]}
          selected={mode === 'subscribe' ? 0 : 1}
          onDidSelect={(d: ISelectData): void => { setMode(d.index === 0 ? 'subscribe' : 'command') }}
          data-testid="redis-mode-selectbox"
        />
      </div>
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={{ flex: 1, minWidth: 0 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('redis.urlPlaceholder')}
            data-testid="redis-url-input"
          />
        </div>
      </HeaderHoverTooltip>
      <div style={{ width: 160, minWidth: 100 }}>
        <RestormVariableInputBox
          value={password}
          onChange={setPassword}
          variables={envVariables}
          helpers={handlebarsHelpers}
          placeholder={t('redis.passwordPlaceholder')}
          data-testid="redis-password-input"
        />
      </div>
      {!inWorkbenchTab && <SendButtonEnvSwitcher>{runButton}</SendButtonEnvSwitcher>}
    </ControlGroup>
  )

  const handleCloseHistoryModal = useCallback(() => { setHistoryModalOpen(false) }, [])

  useEffect(() => {
    const requestId = request.id
    const subscription = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_OPEN,
      (payload) => { if (payload.requestId === requestId) setHistoryModalOpen(true) }
    )
    return () => { subscription.unsubscribe() }
  }, [request.id])

  const responseContent = mode === 'subscribe'
    ? renderStreamFrames(liveMessages.length > 0 ? liveMessages : (subscribeResult?.messages ?? []))
    : renderCommandHistory(commandHistory)

  const showResponse = mode === 'subscribe'
    ? (isSubscribing || liveMessages.length > 0 || subscribeResult !== null)
    : commandHistory.length > 0

  // Fixed action bar, anchored top-right of the workbench tab: opening the
  // response panel must never move the button out from under the pointer.
  const actionToolbar = !inWorkbenchTab ? undefined : (
    <RequestActionToolbar>
      <RoundActionButton
        icon={mode === 'subscribe' ? (isSubscribing ? 'debug-disconnect' : 'plug') : 'run'}
        onClick={mode === 'subscribe' ? (isSubscribing ? handleUnsubscribe : handleSubscribe) : handleRun}
        disabled={mode === 'command' && isRunningCommand}
        tone={mode === 'subscribe' && isSubscribing ? 'stop' : 'run'}
        {...((mode === 'subscribe' && isSubscribing) || !envPaintColor ? {} : { color: envPaintColor })}
        {...((mode === 'subscribe' && isSubscribing) || !envIcon ? {} : { envIcon })}
        envSwitch={!(mode === 'subscribe' && isSubscribing)}
        beamActive={isRunning}
        ariaLabel={mode === 'subscribe' ? (isSubscribing ? t('redis.unsubscribe') : t('redis.subscribe')) : t('redis.run')}
        data-testid="redis-run-button"
      />
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
        isLoading={false}
        showResponse={showResponse}
        infosContent={mode === 'subscribe' ? liveSubscribeInfos : commandInfos}
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

export default RedisRequestTabView
