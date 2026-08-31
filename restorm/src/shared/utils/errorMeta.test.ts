import { describe, it, expect } from 'vitest'
import { errorMeta } from './errorMeta'

describe('errorMeta', () => {
  it('lifts an Error message + stack onto plain enumerable keys', () => {
    const meta = errorMeta(new Error('boom'))
    expect(meta.error).toBe('boom')
    expect(meta.stack).toContain('boom')
    // The keys must be enumerable, or serialising the metadata for a
    // transport / crash reporter would drop them again.
    expect(Object.keys(meta)).toContain('error')
  })

  it('stringifies a non-Error cause', () => {
    expect(errorMeta('plain string')).toEqual({ error: 'plain string' })
    expect(errorMeta(42)).toEqual({ error: '42' })
    expect(errorMeta({ code: 'X' })).toEqual({ error: '[object Object]' })
  })

  it('captures the regression it exists to prevent: a bare Error as metadata serialises to nothing', () => {
    // WHY the old `logger.error('...', error)` was invisible in Sentry: an
    // Error's own message/stack are non-enumerable, so handing the Error
    // straight to the metadata slot loses the cause on serialisation.
    const bare = new Error('boom')
    expect(Object.keys(bare)).toEqual([])
    expect(JSON.stringify(bare)).toBe('{}')
    // errorMeta is the fix — its output round-trips the message.
    const roundTripped = JSON.parse(JSON.stringify(errorMeta(bare))) as { error: string }
    expect(roundTripped.error).toBe('boom')
  })
})
