import React, { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  CodeEditor,
  InputBox,
  SelectBox,
  Toggle,
  SplitView,
  Pane,
  ControlGroup,
  toasterService,
  logger,
  type ISelectData
} from 'electron-core-ui/renderer'
import type { GrpcMockMethod, GrpcRequest, GrpcCallType } from '../../../../shared/types/collections'
import { BaseRequestTabView } from './BaseRequestTabView'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { ServerConfigLockedHint } from '../common/ServerConfigLockedHint'
import { updateReactiveProperty } from './requestTabViewUtils'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { ResolvedUrlPreview } from '../common/ResolvedUrlPreview'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useIsGrpcServerListening } from '../../services/grpcServerListeningStore'
import { conflictSafeBoolean } from '../../services/conflictSafeLiveState'

const serverHostLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 4px', whiteSpace: 'nowrap', opacity: 0.8 }
const serverPortWrapperStyle: CSSProperties = { width: 90, flexShrink: 0 }

/** The four call types, in selector order, for the per-method editor. */
const CALL_TYPE_OPTIONS: { value: GrpcCallType; labelKey: string; fallback: string }[] = [
  { value: 'unary', labelKey: 'grpc.callType.unary', fallback: 'Unary' },
  { value: 'server-stream', labelKey: 'grpc.callType.serverStream', fallback: 'Server streaming' },
  { value: 'client-stream', labelKey: 'grpc.callType.clientStream', fallback: 'Client streaming' },
  { value: 'bidirectional-stream', labelKey: 'grpc.callType.bidi', fallback: 'Bidirectional streaming' }
]

export interface GrpcServerTabViewProps {
  request: GrpcRequest
  /** Blanket conflict-mode safety rule (AC#2/#5, see
   * `conflictSafeLiveState.ts`): forces the listening beam to `false` — a
   * conflict panel is a static historical snapshot, never a live mock
   * server. Only ever set by `ConflictEntityPanel`. */
  conflictMode?: boolean
}

/**
 * SERVER MODE gRPC tab: restorm HOSTS a local gRPC mock server. The host is
 * fixed to localhost — only the port is user-configurable — and the Send button
 * becomes a Listen↔Stop toggle. The proto + per-method mock responses/status are
 * edited in the panes below; each configured method is answered on the wire.
 */
export const GrpcServerTabView: React.FC<GrpcServerTabViewProps> = ({ request, conflictMode }) => {
  const { t } = useTranslation()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()

  const [url, setUrlState] = useState(request.url)
  const [protoContent, setProtoContentState] = useState(request.protoContent ?? '')
  const [mockMethods, setMockMethodsState] = useState<GrpcMockMethod[]>(request.mockMethods ?? [])
  const [reflection, setReflectionState] = useState(request.reflection !== false)
  const [selectedMethodIndex, setSelectedMethodIndex] = useState(0)

  // The listening beam + served count for the hosted server. Conflict-mode
  // guard: see `conflictSafeLiveState.ts`.
  const isListening = conflictSafeBoolean(useIsGrpcServerListening(request.id), conflictMode)
  const [servedCount, setServedCount] = useState(0)

  // localhost-fixed: only the port is editable.
  const serverPort = useMemo(() => {
    const stripped = url.replace(/^[a-z]+:\/\//i, '')
    const authority = stripped.split('/')[0] ?? ''
    return authority.split(':')[1] ?? ''
  }, [url])
  const envVariables = useEnvVariables(request.id)
  // Resolved-address preview: the main process resolves the request's URL
  // (Handlebars substituted) and pushes updates; the fetch covers the value
  // already cached before this tab mounted.
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  useEffect(() => {
    const requestId = request.id
    const unsub = window.restorm?.context.onUrlResolved((result) => {
      if (result.requestId === requestId) setResolvedUrl(result.resolvedUrl)
    })
    void window.restorm?.context.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    return () => { unsub?.() }
  }, [request.id])

  const handlebarsHelpers = useHandlebarsHelpers()
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setServerPort = useCallback((p: string): void => {
    setUrl(`localhost:${p}`)
  }, [setUrl])

  const setProtoContent = useCallback((value: string): void => {
    setProtoContentState(value)
    updateReactiveProperty(request, 'protoContent', value)
  }, [request])

  const setReflection = useCallback((value: boolean): void => {
    setReflectionState(value)
    updateReactiveProperty(request, 'reflection', value)
  }, [request])

  const commitMethods = useCallback((next: GrpcMockMethod[]): void => {
    setMockMethodsState(next)
    updateReactiveProperty(request, 'mockMethods', next)
  }, [request])

  // Merge a patch into the selected method, OMITTING any key whose patched value
  // is `undefined` (so clearing the status code drops the field rather than
  // storing `undefined`, which exactOptionalPropertyTypes forbids).
  const updateSelectedMethod = useCallback((patch: Partial<Record<keyof GrpcMockMethod, unknown>>): void => {
    commitMethods(mockMethods.map((m, i) => {
      if (i !== selectedMethodIndex) return m
      const merged: Record<string, unknown> = { ...m }
      for (const [k, v] of Object.entries(patch)) merged[k] = v
      const next = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined))
      return next as unknown as GrpcMockMethod
    }))
  }, [commitMethods, mockMethods, selectedMethodIndex])

  const addMethod = useCallback((): void => {
    const next: GrpcMockMethod = { service: '', method: '', callType: 'unary', responseMessage: '{}' }
    commitMethods([...mockMethods, next])
    setSelectedMethodIndex(mockMethods.length)
  }, [commitMethods, mockMethods])

  const removeSelectedMethod = useCallback((): void => {
    const next = mockMethods.filter((_, i) => i !== selectedMethodIndex)
    commitMethods(next)
    setSelectedMethodIndex((i) => Math.max(0, Math.min(i, next.length - 1)))
  }, [commitMethods, mockMethods, selectedMethodIndex])

  // Listen = start hosting the gRPC mock server. It stays up until Stop / file
  // close / quit. The lifecycle beam is fed by grpc:server-progress.
  const handleListen = useCallback((): void => {
    if (!request.id || isListening || conflictMode) return
    setServedCount(0)
    void window.restorm?.grpc.listen(request.id)
      .then((res) => {
        if (res.error) {
          toasterService.push('app', { title: t('grpc.server.listenFailed', 'gRPC server failed to start'), body: res.error, durationMs: 10000 })
          logger.error('gRPC mock server failed to listen', { error: res.error })
        }
      })
      .catch((err: unknown) => { logger.error('gRPC mock server listen error', { error: String(err) }) })
  }, [request.id, isListening, conflictMode, t])

  const handleStop = useCallback((): void => {
    void window.restorm?.grpc.stopServer(request.id)
  }, [request.id])

  // Track served-count updates for the banner. Skipped entirely in
  // conflict mode (see `conflictSafeLiveState.ts`) — no live subscription
  // means no live count can ever leak into a static conflict snapshot.
  React.useEffect(() => {
    if (conflictMode) return undefined
    const requestId = request.id
    const unsub = window.restorm?.grpc.onServerServed(({ requestId: rid, count }) => {
      if (rid === requestId) setServedCount(count)
    })
    return () => { unsub?.() }
  }, [request.id, conflictMode])

  const selectedMethod = mockMethods[selectedMethodIndex]

  const methodOptions = useMemo(
    () => mockMethods.map((m, i) => ({ text: String(i), label: `${m.service || '?'}/${m.method || '?'}` })),
    [mockMethods]
  )
  const callTypeIndex = Math.max(0, CALL_TYPE_OPTIONS.findIndex((o) => o.value === selectedMethod?.callType))

  const requestContent = (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {isListening && <ServerConfigLockedHint data-testid="grpc-server-locked-hint" />}
      <SplitView
        orientation="vertical"
        style={{ width: '100%', flex: 1, minHeight: 0 }}
        data-testid="grpc-server-content-splitview"
      >
        <Pane title={t('grpc.server.proto', 'Proto')} initialSize={0.45} minSize={120} data-testid="grpc-server-proto-pane">
          <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
            <CodeEditor
              height="100%"
              language="protobuf"
              value={protoContent}
              onChange={(v) => { setProtoContent(v ?? '') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true, readOnly: isListening }}
              data-testid="grpc-server-proto-editor"
            />
          </div>
        </Pane>
        <Pane
          title={t('grpc.server.methods', 'Mock methods')}
          initialSize={0.55}
          minSize={150}
          data-testid="grpc-server-methods-pane"
          headerActions={() => (
            <Button
              secondary
              small
              icon="add"
              disabled={isListening}
              options={{ ariaLabel: t('grpc.server.addMethod', 'Add method') }}
              onClick={addMethod}
              data-testid="grpc-server-add-method-button"
            />
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }} data-testid="grpc-server-method-editor">
            <ControlGroup>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SelectBox
                  id={`grpc-server-method-select-${request.id}`}
                  className=""
                  options={methodOptions.length > 0 ? methodOptions : [{ text: '0', label: t('grpc.server.noMethods', 'No methods yet') }]}
                  selected={selectedMethodIndex}
                  onDidSelect={(d: ISelectData) => { setSelectedMethodIndex(d.index) }}
                  data-testid="grpc-server-method-select"
                  disabled={isListening}
                />
              </div>
              {mockMethods.length > 0 && (
                <Button
                  secondary
                  small
                  icon="trash"
                  disabled={isListening}
                  options={{ ariaLabel: t('grpc.server.removeMethod', 'Remove method') }}
                  onClick={removeSelectedMethod}
                  data-testid="grpc-server-remove-method-button"
                />
              )}
            </ControlGroup>
            {selectedMethod && (
              <>
                <ControlGroup>
                  <InputBox
                    value={selectedMethod.service}
                    onChange={(v: string) => { updateSelectedMethod({ service: v }) }}
                    options={{ placeholder: t('grpc.server.servicePlaceholder', 'package.Service') }}
                    data-testid="grpc-server-method-service-input"
                    disabled={isListening}
                  />
                  <InputBox
                    value={selectedMethod.method}
                    onChange={(v: string) => { updateSelectedMethod({ method: v }) }}
                    options={{ placeholder: t('grpc.server.methodPlaceholder', 'Method') }}
                    data-testid="grpc-server-method-name-input"
                    disabled={isListening}
                  />
                  <div style={{ minWidth: 150 }}>
                    <SelectBox
                      id={`grpc-server-call-type-${request.id}`}
                      className=""
                      options={CALL_TYPE_OPTIONS.map((o) => ({ text: o.value, label: t(o.labelKey, o.fallback) }))}
                      selected={callTypeIndex}
                      onDidSelect={(d: ISelectData) => {
                        const picked = CALL_TYPE_OPTIONS[d.index]
                        if (picked) updateSelectedMethod({ callType: picked.value })
                      }}
                      data-testid="grpc-server-call-type-select"
                      disabled={isListening}
                    />
                  </div>
                </ControlGroup>
                <ControlGroup>
                  <span style={serverHostLabelStyle}>{t('grpc.server.statusCode', 'Status code')}</span>
                  <div style={{ width: 90 }}>
                    <InputBox
                      value={selectedMethod.statusCode === undefined ? '' : String(selectedMethod.statusCode)}
                      onChange={(v: string) => {
                        const n = v.trim() === '' ? undefined : Number.parseInt(v.replace(/[^0-9]/g, ''), 10)
                        updateSelectedMethod({ statusCode: n })
                      }}
                      options={{ placeholder: '0', type: 'number' }}
                      data-testid="grpc-server-status-code-input"
                      disabled={isListening}
                    />
                  </div>
                  <InputBox
                    value={selectedMethod.statusMessage ?? ''}
                    onChange={(v: string) => { updateSelectedMethod({ statusMessage: v }) }}
                    options={{ placeholder: t('grpc.server.statusMessagePlaceholder', 'Status message (for a non-OK code)') }}
                    data-testid="grpc-server-status-message-input"
                    disabled={isListening}
                  />
                </ControlGroup>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{t('grpc.server.responseLabel', 'Response message (JSON)')}</div>
                <div style={{ height: 160, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
                  <CodeEditor
                    height="100%"
                    language="json"
                    value={selectedMethod.responseMessage}
                    onChange={(v) => { updateSelectedMethod({ responseMessage: v ?? '{}' }) }}
                    options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true, readOnly: isListening }}
                    data-testid="grpc-server-response-editor"
                  />
                </div>
              </>
            )}
          </div>
        </Pane>
      </SplitView>
    </div>
  )

  const urlSection = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
    <ControlGroup data-testid="grpc-server-url-section">
      <span style={serverHostLabelStyle}>localhost:</span>
      <div style={{ ...serverPortWrapperStyle, ...(isListening ? { pointerEvents: 'none' as const, opacity: 0.6 } : {}) }}>
        <RestormVariableInputBox
          value={serverPort}
          onChange={setServerPort}
          variables={envVariables}
          helpers={handlebarsHelpers}
          placeholder="50051"
          data-testid="grpc-server-port-input"
        />
      </div>
      <div style={{ flex: 1 }} />
      <Toggle
        checked={reflection}
        onChange={setReflection}
        data-testid="grpc-server-reflection-toggle"
        disabled={isListening}
      >
        {t('grpc.server.reflection', 'Reflection')}
      </Toggle>
      {!inWorkbenchTab && (
      <BeamWrap active={isListening} size={22} borderWidth={1.5}>
        <Button
          icon={isListening ? 'debug-disconnect' : 'plug'}
          onClick={isListening ? handleStop : handleListen}
          disabled={!!conflictMode}
          {...(isListening ? {} : { emphasis: 1 })}
          options={{
            title: isListening ? t('grpc.server.stopListening', 'Stop server') : t('grpc.server.startListening', 'Start server'),
            ariaLabel: isListening ? t('grpc.server.stopListening', 'Stop server') : t('grpc.server.startListening', 'Start server')
          }}
          data-testid="grpc-server-listen-button"
        />
      </BeamWrap>
      )}
    </ControlGroup>
    <ResolvedUrlPreview value={resolvedUrl} />
    </div>
  )

  // The response panel shows the live listening state + served count (a mock
  // SERVER has no single response).
  const serverResponseContent = (
    <div
      data-testid="grpc-server-served-banner"
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}
    >
      <span className={`codicon codicon-${isListening ? 'broadcast' : 'circle-slash'}`} aria-hidden="true" />
      <span>
        {isListening
          ? t('grpc.server.served', { count: servedCount, defaultValue: 'Listening — {{count}} call(s) served' })
          : t('grpc.server.notListening', 'Not listening')}
      </span>
    </div>
  )

  // Fixed action bar, anchored top-right of the workbench tab. Server mode
  // ignores environments, so the disc keeps its tone and has no env picker.
  const actionToolbar = !inWorkbenchTab ? undefined : (
    <RequestActionToolbar>
      <RoundActionButton
        icon={isListening ? 'debug-disconnect' : 'plug'}
        onClick={isListening ? handleStop : handleListen}
        disabled={!!conflictMode}
        tone={isListening ? 'stop' : 'run'}
        beamActive={isListening}
        ariaLabel={isListening ? t('grpc.server.stopListening', 'Stop server') : t('grpc.server.startListening', 'Start server')}
        data-testid="grpc-server-listen-button"
      />
    </RequestActionToolbar>
  )

  return (
    <BaseRequestTabView
      requestId={request.id}
      urlSection={urlSection}
      {...(actionToolbar ? { actionToolbar } : {})}
      requestContent={requestContent}
      codeSnippetsContent={t('grpc.server.snippetsUnavailable', 'Code snippets are not available for a mock server.')}
      notes={request.notes}
      onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
      isLoading={isListening}
      showResponse={true}
      responseContent={serverResponseContent}
    />
  )
}

export default GrpcServerTabView
