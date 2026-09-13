import { describe, it, expect } from 'vitest'
import { RECORDING_DEDUCE_CAPABILITY, isRecordingDeduceLocked } from '../../src/shared/auth/planCapabilities'

describe('recording.deduceRoutes — the only paid step of a recording session', () => {
  it('is locked on Community (and when no plan is known), open on Pro and Enterprise', () => {
    expect(RECORDING_DEDUCE_CAPABILITY).toBe('recording.deduceRoutes')
    expect(isRecordingDeduceLocked({ plan: 'community' })).toBe(true)
    expect(isRecordingDeduceLocked({ plan: undefined })).toBe(true)
    expect(isRecordingDeduceLocked({ plan: null })).toBe(true)
    expect(isRecordingDeduceLocked({ plan: 'pro' })).toBe(false)
    expect(isRecordingDeduceLocked({ plan: 'enterprise' })).toBe(false)
  })
})
