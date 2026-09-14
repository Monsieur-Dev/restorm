import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, MessageType, eventBus } from 'electron-core-ui/renderer'
import type { RecordingSession } from '../../../../shared/types/collections'
import { RECORDING_PROTOCOLS, type RecordingProtocol } from '../../../../shared/types/recordingSession'
import { isRecordableUrl } from '../../../../shared/recording/recordingUrl'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { useRecordingStatus } from '../../services/recordingStatusStore'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { RoundActionButton } from '../common/RoundActionButton'
import { PatternListEditor } from './PatternListEditor'
import { assignRecordingField, recordingFilterConfigOf } from './recordingMutations'
import './recordingConfigView.css'

export interface RecordingConfigViewProps {
  session: RecordingSession
  /** Start recording the session (opens the browser tab, which starts the engine). */
  onStartRecording: (sessionId: string) => void
  /** Stop the live recording (engine + browser tab). */
  onStopRecording: (sessionId: string) => void
}

const PROTOCOL_LABEL_KEY: Record<RecordingProtocol, string> = {
  http: 'recording.protocol.http',
  websocket: 'recording.protocol.websocket',
  graphql: 'recording.protocol.graphql',
  'grpc-web': 'recording.protocol.grpcWeb'
}

/**
 * The session row's tab: the page url to listen on with the record button
 * beside it (as a request's send button), the protocols to capture, and the
 * white / black lists. Every edit reassigns a top-level field of the
 * reactive session (→ dirty / autosave / promoted tab) and, while a
 * recording runs, is pushed live to the capture engine's gate.
 */
export const RecordingConfigView: React.FC<RecordingConfigViewProps> = ({ session, onStartRecording, onStopRecording }) => {
  const { t } = useTranslation()
  const status = useRecordingStatus(session.id)
  const recording = status.state !== 'idle'

  // Re-render off the session's own document event (an MCP write, a rename,
  // an edit from another tab) without waiting for an app-level refresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const subscription = eventBus.subscribe(DocumentEvents.RECORDING_UPDATED, (payload) => {
      if ((payload as DocumentChangedPayload).id !== session.id) return
      setTick((n) => n + 1)
    })
    return () => { subscription.unsubscribe() }
  }, [session.id])

  const pushFilters = useCallback((next: RecordingSession) => {
    if (status.state === 'idle') return
    void window.restorm?.recording.setFilters(next.id, recordingFilterConfigOf(next))
  }, [status.state])

  const setUrl = useCallback((value: string) => {
    assignRecordingField(session, 'url', value)
  }, [session])

  const toggleProtocol = useCallback((protocol: RecordingProtocol) => {
    const enabled = session.protocols.includes(protocol)
    // At least one protocol stays on — a session listening to nothing is a
    // mistake, not a configuration.
    if (enabled && session.protocols.length === 1) return
    const next = enabled ? session.protocols.filter((p) => p !== protocol) : RECORDING_PROTOCOLS.filter((p) => p === protocol || session.protocols.includes(p))
    assignRecordingField(session, 'protocols', next)
    pushFilters(session)
  }, [session, pushFilters])

  const setWhitelist = useCallback((next: string[]) => {
    assignRecordingField(session, 'whitelist', next)
    pushFilters(session)
  }, [session, pushFilters])

  const setBlacklist = useCallback((next: string[]) => {
    assignRecordingField(session, 'blacklist', next)
    pushFilters(session)
  }, [session, pushFilters])

  const urlValid = isRecordableUrl(session.url)
  const recordTooltip = recording
    ? t('recording.config.stop')
    : urlValid ? t('recording.config.record') : t('recording.config.urlRequired')

  return (
    <div className="recording-config" data-testid="recording-config-view" data-session-id={session.id}>
      <p className="design-section-subtitle">{t('recording.config.subtitle')}</p>

      <label className="design-field design-field-full">
        <span className="design-field-label">{t('recording.config.url')}</span>
        <div className="recording-url-row">
          <div className="recording-url-input">
            <InputBox
              value={session.url}
              onChange={setUrl}
              options={{
                type: 'text',
                placeholder: t('recording.config.urlPlaceholder'),
                ariaLabel: t('recording.config.url'),
                validationOptions: {
                  validation: (value: string) => (value.trim() === '' || isRecordableUrl(value)
                    ? null
                    : { content: t('recording.config.urlInvalid'), type: MessageType.ERROR })
                }
              }}
              data-testid="recording-config-url"
            />
          </div>
          <HeaderHoverTooltip label={recordTooltip}>
            <RoundActionButton
              icon={recording ? 'stop-circle' : 'device-camera-video'}
              tone={recording ? 'stop' : 'run'}
              beamActive={status.state === 'recording'}
              disabled={!recording && !urlValid}
              ariaLabel={recordTooltip}
              onClick={() => { if (recording) onStopRecording(session.id); else onStartRecording(session.id) }}
              className="recording-record-button"
              data-testid="recording-config-record"
            />
          </HeaderHoverTooltip>
        </div>
      </label>

      <div className="design-field design-field-full">
        <span className="design-field-label">{t('recording.config.protocols')}</span>
        <div className="design-serve-protocols recording-protocols" data-testid="recording-config-protocols">
          {RECORDING_PROTOCOLS.map((protocol) => {
            const active = session.protocols.includes(protocol)
            return (
              <button
                key={protocol}
                type="button"
                className={`design-protocol-pill${active ? ' active' : ''}`}
                data-testid={`recording-protocol-${protocol}`}
                aria-pressed={active}
                onClick={() => { toggleProtocol(protocol) }}
              >
                {t(PROTOCOL_LABEL_KEY[protocol])}
              </button>
            )
          })}
        </div>
      </div>

      <div className="recording-filter-lists">
        <PatternListEditor
          patterns={session.whitelist}
          onChange={setWhitelist}
          label={t('recording.config.whitelist')}
          data-testid="recording-config-whitelist"
        />
        <PatternListEditor
          patterns={session.blacklist}
          onChange={setBlacklist}
          label={t('recording.config.blacklist')}
          data-testid="recording-config-blacklist"
        />
      </div>
      <p className="design-field-hint">{t('recording.config.filtersHint')}</p>
    </div>
  )
}
