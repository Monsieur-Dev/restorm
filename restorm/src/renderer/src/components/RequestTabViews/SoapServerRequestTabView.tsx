import React, { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react'
import { pushServerListenErrorToast } from '../../services/serverListenErrorToast'
import { useIsActiveWorkbenchTab, useServerMenuPublisher } from '../../services/serverMenuStore'
import type { SidebarContextMenuItem } from '../MainView/Sidebar/contextMenuBuilder'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  Toggle,
  CodeEditor,
  ControlGroup,
  ScrollableElement,
  logger,
  type Tab
} from 'electron-core-ui/renderer'
import type { SoapRequest, SoapMockOperation } from '../../../../shared/types/requests/SoapRequest'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { BaseRequestTabView } from './BaseRequestTabView'
import { updateReactiveProperty } from './requestTabViewUtils'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { ResolvedUrlPreview } from '../common/ResolvedUrlPreview'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { ServerConfigLockedHint } from '../common/ServerConfigLockedHint'
import { cloneForEventBus } from '../../utils/cloneForEventBus'

export interface SoapServerRequestTabViewProps {
  request: SoapRequest
  /** Blanket conflict-mode safety rule (AC#2/#5, see
   * `conflictSafeLiveState.ts`): skips the listening/served-count
   * subscription — a conflict panel is a static historical snapshot,
   * never a live mock server. Only ever set by `ConflictEntityPanel`. */
  conflictMode?: boolean
  /** Conflict resolution: restrict the request-side tab strip to these
   * ids (forwarded verbatim to `BaseRequestTabView`). */
  conflictVisibleTabIds?: string[]
  /** Conflict resolution: extra tabs appended to the strip (the contested
   * tag list), forwarded verbatim to `BaseRequestTabView`. */
  conflictExtraTabs?: Tab[]
}

// SERVER MODE URL-section pieces — mirror the HTTP mock server layout.
const serverHostLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 4px', whiteSpace: 'nowrap', opacity: 0.8 }
const serverPortWrapperStyle: CSSProperties = { width: 80, flexShrink: 0 }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }

/** Split `localhost:<port>/<route>` (scheme optional) into its port + route. */
function parseServerUrl(raw: string): { port: string; route: string } {
  const stripped = raw.replace(/^[a-z]+:\/\//i, '')
  const slash = stripped.indexOf('/')
  const hostPort = slash >= 0 ? stripped.slice(0, slash) : stripped
  const route = slash >= 0 ? stripped.slice(slash + 1) : ''
  const port = hostPort.split(':')[1] ?? ''
  return { port, route }
}

/**
 * SOAP mock server tab — restorm HOSTS a local SOAP endpoint that answers
 * configured operations with canned XML envelopes (incl. `<soap:Fault>`).
 * DERIVES from the HTTP mock server tab: localhost-fixed host + port + route,
 * a Listen↔Stop toggle (no Send), a "served N requests" banner, plus a
 * SOAP-specific operations editor (the canned responses dispatched by SOAPAction
 * / body operation name).
 */
export const SoapServerRequestTabView: React.FC<SoapServerRequestTabViewProps> = ({ request, conflictMode, conflictVisibleTabIds, conflictExtraTabs }) => {
  const { t } = useTranslation()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const { selectedEnvId, environments } = useEnvironmentContext()

  const [url, setUrlState] = useState(request.url)
  const [operations, setOperationsState] = useState<SoapMockOperation[]>(() => request.mockOperations ?? [])
  const [isListening, setIsListening] = useState(false)
  const [servedCount, setServedCount] = useState(0)
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  const { port: serverPort, route: serverRoute } = useMemo(() => parseServerUrl(url), [url])
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

  const composeServerUrl = useCallback((port: string, routePart: string): string => {
    const cleanRoute = routePart.replace(/^\/+/, '')
    return `localhost:${port}/${cleanRoute}`
  }, [])

  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setServerPort = useCallback((p: string): void => { setUrl(composeServerUrl(p, serverRoute)) }, [composeServerUrl, serverRoute, setUrl])
  const setServerRoute = useCallback((r: string): void => { setUrl(composeServerUrl(serverPort, r)) }, [composeServerUrl, serverPort, setUrl])

  const setOperations = useCallback((next: SoapMockOperation[]): void => {
    setOperationsState(next)
    updateReactiveProperty(request, 'mockOperations', next)
  }, [request])

  // Register the request with ContextService so its URL + mock operations resolve
  // in the main process even when no other tab opened it.
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueDataShared(request.headers)
    })
    return () => { void window.restorm?.context.unregisterRequest(requestId) }
  }, [request.id, request.headers, selectedEnvId, environments])

  // Keep the main-process context in sync with the edited URL + operations.
  useEffect(() => {
    void window.restorm?.context.updateFullRequestData(request.id, cloneForEventBus({
      url,
      method: 'POST',
      requestType: 'soap',
      headers: toKeyValueDataShared(request.headers),
      server: true,
      soapMockOperations: operations
    }), sourceIdRef.current)
  }, [request.id, request.headers, url, operations])

  // Track listening state + served count for the hosted mock route.
  // Skipped entirely in conflict mode (see `conflictSafeLiveState.ts`) — a
  // static historical snapshot must never pick up another tab's live state.
  useEffect(() => {
    if (conflictMode) return undefined
    const requestId = request.id
    let cancelled = false
    void window.restorm?.soap.isListening(requestId).then((listening) => {
      if (!cancelled) setIsListening(listening)
    })
    const unsubProgress = window.restorm?.soap.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') { setIsListening(true); setServedCount(0) }
      if (status === 'completed' || status === 'cancelled' || status === 'error') setIsListening(false)
    })
    const unsubServed = window.restorm?.soap.onServerServed(({ requestId: rid, count }) => {
      if (rid !== requestId) return
      setServedCount(count)
    })
    return () => { cancelled = true; unsubProgress?.(); unsubServed?.() }
  }, [request.id, conflictMode])

  const handleListen = useCallback((): void => {
    const requestId = request.id
    if (!requestId || isListening || conflictMode) return
    setServedCount(0)
    void window.restorm?.soap.listen(requestId)
      .then((res) => {
        if (res.error) {
          pushServerListenErrorToast(t, t('soap.server.listenFailed', 'Could not start the SOAP mock server'), res.error, serverPort)
          logger.error('SOAP mock server failed to listen', { error: res.error })
        }
      })
      .catch((err: unknown) => { logger.error('SOAP mock server listen error', { error: String(err) }) })
  }, [request.id, isListening, conflictMode, t, serverPort])

  const handleStop = useCallback((): void => { void window.restorm?.soap.stop(request.id) }, [request.id])

  // « Serveur » menu-bar entries — the SAME action as the toolbar disc
  // (start ↔ stop toggle), published while this server tab is the ACTIVE one.
  const serverMenuOpsRef = useRef({ listen: () => { /* replaced below */ }, stop: () => { /* replaced below */ } })
  useEffect(() => { serverMenuOpsRef.current = { listen: handleListen, stop: handleStop } })
  const isActiveTab = useIsActiveWorkbenchTab()
  const serverMenuItems = useMemo<SidebarContextMenuItem[]>(() => [
    isListening
      ? { id: 'server-stop', label: t('soap.server.stopListening', 'Stop the SOAP mock server'), icon: 'debug-disconnect', shortcut: 'F8', onClick: () => { serverMenuOpsRef.current.stop() } }
      : { id: 'server-listen', label: t('soap.server.startListening', 'Start the SOAP mock server'), icon: 'plug', shortcut: 'F5', ...(conflictMode ? { disabled: true } : {}), onClick: () => { serverMenuOpsRef.current.listen() } }
  ], [isListening, conflictMode, t])
  useServerMenuPublisher(isActiveTab, serverMenuItems)

  const updateOperation = useCallback((index: number, patch: Partial<SoapMockOperation>): void => {
    setOperations(operations.map((op, i) => (i === index ? { ...op, ...patch } : op)))
  }, [operations, setOperations])
  const addOperation = useCallback((): void => {
    setOperations([...operations, { name: `Operation${operations.length + 1}`, responseBody: '' }])
  }, [operations, setOperations])
  const removeOperation = useCallback((index: number): void => {
    setOperations(operations.filter((_, i) => i !== index))
  }, [operations, setOperations])

  // URL section: localhost-fixed host + port + route + Listen↔Stop toggle.
  const urlSection = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
    <ControlGroup data-testid="soap-server-url-section">
      <span style={serverHostLabelStyle} data-testid="soap-server-host">localhost:</span>
      <div style={{ ...serverPortWrapperStyle, ...(isListening ? { pointerEvents: 'none' as const, opacity: 0.6 } : {}) }}>
        <RestormVariableInputBox
          value={serverPort}
          onChange={setServerPort}
          variables={envVariables}
          helpers={handlebarsHelpers}
          placeholder="8080"
          ariaLabel={t('soap.server.portLabel', 'Port')}
          data-testid="soap-server-port-input"
        />
      </div>
      <span style={serverHostLabelStyle}>/</span>
      <div style={{ ...urlInputWrapperStyle, ...(isListening ? { pointerEvents: 'none' as const, opacity: 0.6 } : {}) }}>
        <RestormVariableInputBox
          value={serverRoute}
          onChange={setServerRoute}
          variables={envVariables}
          helpers={handlebarsHelpers}
          ariaLabel={t('soap.server.routeLabel', 'Route')}
          data-testid="soap-server-route-input"
        />
      </div>
      {!inWorkbenchTab && (
      <BeamWrap active={isListening} size={22} borderWidth={1.5}>
        <Button
          icon={isListening ? 'debug-disconnect' : 'plug'}
          onClick={isListening ? handleStop : handleListen}
          disabled={!!conflictMode}
          {...(isListening ? {} : { emphasis: 1 })}
          options={{
            title: isListening ? t('soap.server.stopListening', 'Stop the SOAP mock server') : t('soap.server.startListening', 'Start the SOAP mock server'),
            ariaLabel: isListening ? t('soap.server.stopListening', 'Stop the SOAP mock server') : t('soap.server.startListening', 'Start the SOAP mock server')
          }}
          data-testid="soap-server-listen-button"
        />
      </BeamWrap>
      )}
    </ControlGroup>
    <ResolvedUrlPreview value={resolvedUrl} />
    </div>
  )

  // Operations editor: one row per mock operation (name + SOAPAction + Fault
  // toggle + the canned XML response).
  const requestContent = (
    <ScrollableElement options={{ horizontal: 'hidden' }} className="soap-server-operations-scroll">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 8 }} data-testid="soap-server-operations">
        {isListening && <ServerConfigLockedHint data-testid="soap-server-locked-hint" />}
        {operations.map((op, i) => (
          <div
            key={i}
            data-testid={`soap-server-operation-${i}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--panel-border)', borderRadius: 3, padding: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <InputBox
                  value={op.name}
                  onChange={(v) => { updateOperation(i, { name: v }) }}
                  options={{ placeholder: t('soap.server.operationNamePlaceholder', 'Operation name'), ariaLabel: t('soap.server.operationNameLabel', 'Operation name') }}
                  data-testid={`soap-server-operation-name-${i}`}
                  disabled={isListening}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <InputBox
                  value={op.soapAction ?? ''}
                  onChange={(v) => { updateOperation(i, { soapAction: v }) }}
                  options={{ placeholder: t('soap.server.soapActionPlaceholder', 'SOAPAction (optional)'), ariaLabel: t('soap.server.soapActionLabel', 'SOAPAction') }}
                  data-testid={`soap-server-operation-action-${i}`}
                  disabled={isListening}
                />
              </div>
              <Toggle
                checked={op.isFault === true}
                onChange={(checked) => { updateOperation(i, { isFault: checked }) }}
                aria-label={t('soap.server.faultLabel', 'Fault')}
                data-testid={`soap-server-operation-fault-${i}`}
                disabled={isListening}
              >
                {t('soap.server.faultLabel', 'Fault')}
              </Toggle>
              <Button
                secondary
                small
                icon="trash"
                onClick={() => { removeOperation(i) }}
                options={{ ariaLabel: t('soap.server.removeOperation', 'Remove operation'), title: t('soap.server.removeOperation', 'Remove operation') }}
                data-testid={`soap-server-operation-remove-${i}`}
                disabled={isListening}
              />
            </div>
            <div style={{ height: 160, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
              <CodeEditor
                height="100%"
                language="xml"
                value={op.responseBody}
                onChange={(v) => { updateOperation(i, { responseBody: v ?? '' }) }}
                options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true, readOnly: isListening }}
                data-testid={`soap-server-operation-body-${i}`}
              />
            </div>
          </div>
        ))}
        <Button
          secondary
          icon="add"
          onClick={addOperation}
          data-testid="soap-server-add-operation"
          disabled={isListening}
        >
          {t('soap.server.addOperation', 'Add operation')}
        </Button>
      </div>
    </ScrollableElement>
  )

  const serverResponseContent = (
    <div
      data-testid="soap-server-served-banner"
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}
    >
      <span className={`codicon codicon-${isListening ? 'broadcast' : 'circle-slash'}`} aria-hidden="true" />
      <span>
        {isListening
          ? t('soap.server.served', { count: servedCount, defaultValue: 'Listening — {{count}} request(s) served' })
          : t('soap.server.notListening', 'Not listening')}
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
        ariaLabel={isListening ? t('soap.server.stopListening', 'Stop the SOAP mock server') : t('soap.server.startListening', 'Start the SOAP mock server')}
        data-testid="soap-server-listen-button"
      />
    </RequestActionToolbar>
  )

  return (
    <BaseRequestTabView
      {...(conflictVisibleTabIds ? { visibleRequestTabIds: conflictVisibleTabIds } : {})}
        {...(conflictExtraTabs ? { extraRequestTabs: conflictExtraTabs } : {})}
      requestId={request.id}
      urlSection={urlSection}
      {...(actionToolbar ? { actionToolbar } : {})}
      requestContent={requestContent}
      codeSnippetsContent={t('soap.server.noCodeSnippets', 'A SOAP mock server has no client code snippet.')}
      notes={request.notes}
      onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
      isLoading={false}
      showResponse={isListening}
      responseContent={serverResponseContent}
    />
  )
}

export default SoapServerRequestTabView
