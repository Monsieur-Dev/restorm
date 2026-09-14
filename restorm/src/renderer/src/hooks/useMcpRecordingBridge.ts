/**
 * Renderer half of the MCP `start_recording` / `stop_recording` tools.
 *
 * The capture engine attaches to the mini-browser view, which only exists
 * once the workbench has mounted the session's browser tab — so main cannot
 * start a recording alone. It broadcasts `mcp:start-recording` and this hook
 * runs the exact flow the record button runs (stage the intent, open the
 * browser tab), acking whether this window holds the session. Main then
 * watches the engine's status on its side; the ack never claims the engine
 * attached. `mcp:stop-recording` arrives after main already stopped the
 * engine — the renderer only owns the browser tab and the staged intent.
 *
 * Handlers are read through refs so the listener never re-subscribes when
 * the tree (and thus the handlers' closures) changes.
 */

import { useEffect, useRef } from 'react'
import { logger } from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/collections'
import { isRecordingSession } from '../../../shared/types/collections'
import { findItemById } from '../utils/treeSearch'

interface RestormRecordingBridge {
  onMcpStartRecording?: (cb: (payload: { requestId: string; sessionId: string }) => void) => () => void
  replyMcpStartRecording?: (payload: { requestId: string; accepted: boolean }) => void
  onMcpStopRecording?: (cb: (payload: { sessionId: string }) => void) => () => void
}

export interface UseMcpRecordingBridgeInput {
  enabled: boolean
  rootItemsRef: { current: FolderItem[] }
  /** The record button's start flow. */
  startRecording: (sessionId: string) => void
  /** The stop flow (closes the browser tab; the engine is already stopped). */
  stopRecording: (sessionId: string) => void
}

export function useMcpRecordingBridge(input: UseMcpRecordingBridgeInput): void {
  const { enabled, rootItemsRef, startRecording, stopRecording } = input
  const startRef = useRef(startRecording)
  const stopRef = useRef(stopRecording)
  useEffect(() => { startRef.current = startRecording }, [startRecording])
  useEffect(() => { stopRef.current = stopRecording }, [stopRecording])

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormRecordingBridge } }
    const api = root.restorm?.runtime
    // An out-of-date preload bundle may lack the recording handshake: stay
    // silent rather than throw inside the effect.
    if (!api || typeof api.onMcpStartRecording !== 'function' || typeof api.onMcpStopRecording !== 'function') return

    const offStart = api.onMcpStartRecording(({ requestId, sessionId }) => {
      const ack = (accepted: boolean): void => {
        if (typeof api.replyMcpStartRecording === 'function') api.replyMcpStartRecording({ requestId, accepted })
      }
      try {
        const item = findItemById(rootItemsRef.current, sessionId)
        if (item === null || !isRecordingSession(item)) { ack(false); return }
        startRef.current(sessionId)
        ack(true)
      } catch (error) {
        // A failure here must not wedge the MCP call: ack negative so main
        // reports an explicit error instead of waiting for the timeout.
        logger.error('[mcp:start-recording] handler failed; acking not-accepted', { error: String(error) })
        ack(false)
      }
    })

    const offStop = api.onMcpStopRecording(({ sessionId }) => {
      stopRef.current(sessionId)
    })

    return () => {
      offStart()
      offStop()
    }
  }, [enabled, rootItemsRef])
}
