import React, { useEffect, useMemo, useRef } from 'react'
import { MiniBrowserPanel, type MiniBrowserDriver } from 'electron-core-ui/renderer'
import type { RecordingSession } from '../../../../shared/types/collections'
import { miniBrowserDriver } from '../../services/miniBrowserDriver'
import { takePendingRecordingStart } from '../../services/recordingIntent'
import { recordingFilterConfigOf } from './recordingMutations'
import { RecordingBrowserControls } from './RecordingBrowserControls'

export interface RecordingBrowserPanelProps {
  session: RecordingSession
  /** The workbench tab id — doubles as the mini-browser view's tab id. */
  tabId: string
  /** Stop the recording (engine + this tab). */
  onStop: (sessionId: string) => void
}

/**
 * The session's browser tab: the mini-browser opened on the session's url,
 * whose web contents the capture engine listens to. The engine starts as
 * soon as the view exists (the driver's `create` resolves) — but only for a
 * staged start (the record button); a browser tab restored on relaunch
 * records nothing. Unmounting the tab (Stop, close) stops the recording.
 */
export const RecordingBrowserPanel: React.FC<RecordingBrowserPanelProps> = ({ session, tabId, onStop }) => {
  // The driver is created once (a new driver identity would re-create the
  // view); it reads the LIVE session through a ref synced after each render.
  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session }, [session])
  // Same for the stop callback: an inline arrow from the parent changes on
  // every render, and a driver that followed it would re-create the view
  // (reload + focus steal) at each click anywhere in the app.
  const onStopRef = useRef(onStop)
  useEffect(() => { onStopRef.current = onStop }, [onStop])
  const startedRef = useRef(false)

  const driver = useMemo<MiniBrowserDriver>(() => ({
    ...miniBrowserDriver,
    create: async (viewTabId: string, initialUrl?: string) => {
      const created = await miniBrowserDriver.create(viewTabId, initialUrl)
      if (!startedRef.current && takePendingRecordingStart(sessionRef.current.id)) {
        startedRef.current = true
        const live = sessionRef.current
        const url = initialUrl ?? live.url
        const started = await window.restorm?.recording.start(live.id, viewTabId, url, recordingFilterConfigOf(live))
        // The view started loading the page before the engine attached: reload
        // it now, so the calls the page makes while loading (and a WebSocket
        // it opens at load — only reported at connection time) are captured.
        if (started?.ok === true) {
          await miniBrowserDriver.reload(viewTabId)
        } else {
          // Nothing is recording: close the browser tab again so the Record
          // button starts from scratch instead of finding a tab it cannot re-arm.
          startedRef.current = false
          onStopRef.current(live.id)
        }
      }
      return created
    }
  }), [])

  useEffect(() => {
    const sessionId = session.id
    return () => {
      if (startedRef.current) void window.restorm?.recording.stop(sessionId)
    }
  }, [session.id])

  return (
    <MiniBrowserPanel
      tabId={tabId}
      initialUrl={session.url}
      onUrlChange={() => { /* the session keeps its configured start url; navigation is free */ }}
      driver={driver}
      toolbarActions={<RecordingBrowserControls sessionId={session.id} onStop={onStop} />}
    />
  )
}
