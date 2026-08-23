// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { decodeSessionInfo, isSessionExpired } from './sessionToken'
import { signSession } from '../entitlement/entitlementTestKit'

const IAT = 1_700_000_000
// Local audience constant — SESSION_AUDIENCE is no longer exported by ECUI's
// sessionToken (it is injected by the caller). Use the test kit's value.
const SESSION_AUD = 'ecui-session'

describe('sessionToken', () => {
  let token: string
  beforeAll(async () => {
    token = await signSession({ secret: 'a-secret-at-least-32-bytes-long-xxxxxx', email: 'u@e.com', org: 'org-9', iatSeconds: IAT })
  })

  it('decodes email / org / exp / aud from the payload (unverified)', () => {
    const info = decodeSessionInfo(token)
    expect(info?.email).toBe('u@e.com')
    expect(info?.org).toBe('org-9')
    expect(info?.aud).toBe(SESSION_AUD)
    expect(info?.exp).toBe(IAT + 60 * 60 * 24 * 30)
  })

  it('decodes name + photoUrl when the JWT carries them', async () => {
    const withProfile = await signSession({
      secret: 'a-secret-at-least-32-bytes-long-xxxxxx',
      email: 'u@e.com',
      name: 'Ada Lovelace',
      photoUrl: 'https://lh3.googleusercontent.com/a/ada',
      iatSeconds: IAT
    })
    const info = decodeSessionInfo(withProfile)
    expect(info?.name).toBe('Ada Lovelace')
    expect(info?.photoUrl).toBe('https://lh3.googleusercontent.com/a/ada')
  })

  it('decodes the membership role from the payload', async () => {
    const asAdmin = decodeSessionInfo(token) // signSession defaults role=admin
    expect(asAdmin?.role).toBe('admin')
    const asMember = await signSession({
      secret: 'a-secret-at-least-32-bytes-long-xxxxxx',
      email: 'seat@e.com',
      role: 'member',
      iatSeconds: IAT
    })
    expect(decodeSessionInfo(asMember)?.role).toBe('member')
  })

  it('leaves name + photoUrl undefined when the JWT omits them (provider gave none)', () => {
    const info = decodeSessionInfo(token)
    expect(info?.name).toBeUndefined()
    expect(info?.photoUrl).toBeUndefined()
  })

  it('returns null for a non-JWT string', () => {
    expect(decodeSessionInfo('garbage')).toBeNull()
    expect(decodeSessionInfo('a.b')).toBeNull()
  })

  it('isSessionExpired is false before exp and true after', () => {
    expect(isSessionExpired(token, IAT + 60 * 60 * 24 * 29, SESSION_AUD)).toBe(false)
    expect(isSessionExpired(token, IAT + 60 * 60 * 24 * 31, SESSION_AUD)).toBe(true)
  })

  it('treats a malformed / missing-exp / wrong-aud token as expired', async () => {
    expect(isSessionExpired('garbage', IAT, SESSION_AUD)).toBe(true)
    const wrongAud = await signSession({ secret: 'a-secret-at-least-32-bytes-long-xxxxxx', iatSeconds: IAT, audience: 'example-state' })
    expect(isSessionExpired(wrongAud, IAT + 10, SESSION_AUD)).toBe(true)
  })
})
