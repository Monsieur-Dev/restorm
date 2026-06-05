import { describe, it, expect } from 'vitest'
import { applyJwt } from './scenarioJwt'

// A standard HS256 sample token (jwt.io): {"alg":"HS256","typ":"JWT"} /
// {"sub":"1234567890","name":"John Doe","iat":1516239022}
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

describe('scenarioJwt — the one JWT-decode core (runtime + preview)', () => {
  it('decodes header + payload and keeps the raw signature', () => {
    const out = applyJwt(SAMPLE)
    expect(out.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(out.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })
    expect(out.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
  })

  it('decodes a UTF-8 (multi-byte) claim', () => {
    // {"name":"Café €"} as base64url, with a 2-segment (unsigned) token
    const header = 'eyJhbGciOiJub25lIn0' // {"alg":"none"}
    const payload = 'eyJuYW1lIjoiQ2Fmw6kg4oKsIn0' // {"name":"Café €"}
    const out = applyJwt(`${header}.${payload}`)
    expect(out.payload).toEqual({ name: 'Café €' })
    expect(out.signature).toBe('')
  })

  it('a non-string token THROWS (→ error port)', () => {
    expect(() => applyJwt(42)).toThrow(/string/)
    expect(() => applyJwt(null)).toThrow()
  })

  it('a token without two segments THROWS', () => {
    expect(() => applyJwt('notajwt')).toThrow(/header\.payload/)
  })

  it('a segment that is not base64url JSON THROWS', () => {
    expect(() => applyJwt('!!!.@@@')).toThrow()
  })
})
