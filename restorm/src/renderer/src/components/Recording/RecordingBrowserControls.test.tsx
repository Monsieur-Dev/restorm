import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen, act } from '@testing-library/react'

vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
})

import { RecordingBrowserControls } from './RecordingBrowserControls'
import { resetRecordingStatusStoreForTests } from '../../services/recordingStatusStore'
import type { RecordingStatus } from '../../../../shared/types/recordingCapture'

describe('RecordingBrowserControls', () => {
  const setPaused = vi.fn()
  let pushStatus: ((status: RecordingStatus) => void) | null = null
  beforeEach(() => {
    resetRecordingStatusStoreForTests()
    setPaused.mockClear()
    pushStatus = null
    ;(window as unknown as { restorm: unknown }).restorm = {
      recording: {
        setPaused,
        status: () => Promise.resolve({ sessionId: 's1', state: 'idle', runId: null, tabId: null, captureCount: 0 }),
        onStatusChanged: (cb: (status: RecordingStatus) => void) => { pushStatus = cb; return () => undefined }
      }
    }
  })

  it('pauses a live recording and resumes a paused one', () => {
    render(<RecordingBrowserControls sessionId="s1" onStop={vi.fn()} />)
    act(() => { pushStatus?.({ sessionId: 's1', state: 'recording', runId: 'r1', tabId: 't1', captureCount: 3 }) })
    fireEvent.click(screen.getByTestId('recording-browser-pause'))
    expect(setPaused).toHaveBeenLastCalledWith('s1', true)
    act(() => { pushStatus?.({ sessionId: 's1', state: 'paused', runId: 'r1', tabId: 't1', captureCount: 3 }) })
    expect(screen.getByTestId('recording-browser-controls').getAttribute('data-recording-state')).toBe('paused')
    fireEvent.click(screen.getByTestId('recording-browser-pause'))
    expect(setPaused).toHaveBeenLastCalledWith('s1', false)
  })

  it('stop hands the session back to the caller', () => {
    const onStop = vi.fn()
    render(<RecordingBrowserControls sessionId="s1" onStop={onStop} />)
    fireEvent.click(screen.getByTestId('recording-browser-stop'))
    expect(onStop).toHaveBeenCalledWith('s1')
  })
})
