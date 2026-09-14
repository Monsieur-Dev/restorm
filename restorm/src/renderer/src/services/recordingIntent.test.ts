import { describe, it, expect } from 'vitest'
import { requestRecordingStart, takePendingRecordingStart, clearPendingRecordingStart } from './recordingIntent'

describe('recordingIntent — the record button → browser tab hand-off', () => {
  it('is consumed exactly once', () => {
    requestRecordingStart('s1')
    expect(takePendingRecordingStart('s1')).toBe(true)
    expect(takePendingRecordingStart('s1')).toBe(false)
  })

  it('a tab that was not asked to record finds nothing', () => {
    expect(takePendingRecordingStart('never-staged')).toBe(false)
  })

  it('a stop clears a stale intent', () => {
    requestRecordingStart('s2')
    clearPendingRecordingStart('s2')
    expect(takePendingRecordingStart('s2')).toBe(false)
  })
})
