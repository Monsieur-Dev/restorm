import { describe, it, expect, beforeEach } from 'vitest'
import { getRecordingStatus, primeRecordingStatus, resetRecordingStatusStoreForTests } from './recordingStatusStore'

describe('recordingStatusStore', () => {
  beforeEach(() => { resetRecordingStatusStoreForTests() })

  it('hands back the SAME idle snapshot for an unknown session on every call', () => {
    // `useSyncExternalStore` compares snapshots by identity: a fresh object
    // per call re-renders forever (React error #185, seen in the sidebar).
    const first = getRecordingStatus('s1')
    expect(getRecordingStatus('s1')).toBe(first)
    expect(first).toEqual({ sessionId: 's1', state: 'idle', runId: null, tabId: null, captureCount: 0 })
    expect(getRecordingStatus('s2')).not.toBe(first)
  })

  it('priming without a bridge is a harmless no-op', () => {
    expect(() => { primeRecordingStatus('s1') }).not.toThrow()
    expect(getRecordingStatus('s1').state).toBe('idle')
  })
})
