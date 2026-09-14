import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useRecordingStatus } from '../../services/recordingStatusStore'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { RoundActionButton } from '../common/RoundActionButton'
import './recordingBrowserControls.css'

export interface RecordingBrowserControlsProps {
  sessionId: string
  /** Stop the recording: engine + browser tab (the session's camera row follows). */
  onStop: (sessionId: string) => void
}

/**
 * The two round buttons at the right end of the recording browser's address
 * line: Pause (smaller — keeps listening, stores nothing; toggles to Resume)
 * and Stop (ends the recording, closes the browser tab). The Stop disc runs
 * the on-air beam while recording and holds it still while paused.
 */
export const RecordingBrowserControls: React.FC<RecordingBrowserControlsProps> = ({ sessionId, onStop }) => {
  const { t } = useTranslation()
  const status = useRecordingStatus(sessionId)
  const paused = status.state === 'paused'
  const pauseLabel = paused ? t('recording.browser.resume') : t('recording.browser.pause')
  const stopLabel = t('recording.browser.stop')

  const togglePause = useCallback(() => {
    void window.restorm?.recording.setPaused(sessionId, !paused)
  }, [sessionId, paused])

  return (
    <div className={`recording-browser-controls${paused ? ' recording-browser-controls--paused' : ''}`} data-testid="recording-browser-controls" data-recording-state={status.state}>
      <HeaderHoverTooltip label={pauseLabel}>
        <RoundActionButton
          icon={paused ? 'play' : 'debug-pause'}
          size="secondary"
          tone="neutral"
          ariaLabel={pauseLabel}
          onClick={togglePause}
          disabled={status.state === 'idle'}
          data-testid="recording-browser-pause"
        />
      </HeaderHoverTooltip>
      <HeaderHoverTooltip label={stopLabel}>
        <RoundActionButton
          icon="debug-stop"
          tone="stop"
          beamActive={status.state !== 'idle'}
          ariaLabel={stopLabel}
          onClick={() => { onStop(sessionId) }}
          data-testid="recording-browser-stop"
        />
      </HeaderHoverTooltip>
    </div>
  )
}
