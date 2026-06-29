// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { decodeSessionInfo, isSessionExpired, SESSION_AUDIENCE } from './sessionToken'
import { signSession } from '../entitlement/entitlementTestKit'

const IAT = 1_700_000_000

describe('sessionToken', () => {
  let token: string
  beforeAll(async () => {
    token = await signSession({ secret: 'a-secret-at-least-32-bytes-long-xxxxxx', email: 'u@e.com', org: 'org-9', iatSeconds: IAT })
  })

  it('decodes email / org / exp / aud from the payload (unverified)', () => {
    const info = decodeSessionInfo(token)
    expect(info?.email).toBe('u@e.com')
    expect(info?.org).toBe('org-9')
    expect(info?.aud).toBe(SESSION_AUDIENCE)
    expect(info?.exp).toBe(IAT + 60 * 60 * 24 * 30)
  })

  it('returns null for a non-JWT string', () => {
    expect(decodeSessionInfo('garbage')).toBeNull()
    expect(decodeSessionInfo('a.b')).toBeNull()
  })

  it('isSessionExpired is false before exp and true after', () => {
    expect(isSessionExpired(token, IAT + 60 * 60 * 24 * 29)).toBe(false)
    expect(isSessionExpired(token, IAT + 60 * 60 * 24 * 31)).toBe(true)
  })

  it('treats a malformed / missing-exp / wrong-aud token as expired', async () => {
    expect(isSessionExpired('garbage', IAT)).toBe(true)
    const wrongAud = await signSession({ secret: 'a-secret-at-least-32-bytes-long-xxxxxx', iatSeconds: IAT, audience: 'restorm-state' })
    expect(isSessionExpired(wrongAud, IAT + 10)).toBe(true)
  })
})
