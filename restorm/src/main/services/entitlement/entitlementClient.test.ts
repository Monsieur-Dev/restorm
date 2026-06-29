// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import {
  verifyEntitlementToken,
  fetchEntitlement,
  isWithinGrace,
  needsRefresh,
  ENTITLEMENT_AUDIENCE
} from './entitlementClient'
import { entitlementPublicKeyPem } from './keys'
import { generateEdKeyPair, signEntitlement, type EdKeyPair } from './entitlementTestKit'

const IAT = 1_700_000_000 // fixed epoch seconds for determinism
const at = (secondsAfterIat: number): (() => number) => () => (IAT + secondsAfterIat) * 1000

describe('verifyEntitlementToken', () => {
  let keys: EdKeyPair

  beforeAll(async () => {
    keys = await generateEdKeyPair()
  })

  it('verifies a valid entitlement and recovers the claims', async () => {
    const token = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      org: 'org-42',
      plan: 'pro',
      capabilities: ['scenario.stepDebug', 'scenario.headless']
    })
    const claims = await verifyEntitlementToken(token, keys.publicSpkiPem, { now: at(60) })
    expect(claims.org).toBe('org-42')
    expect(claims.plan).toBe('pro')
    expect(claims.capabilities).toEqual(['scenario.stepDebug', 'scenario.headless'])
    expect(claims.exp).toBe(IAT + 60 * 60 * 24 * 15)
    expect(claims.refreshAfter).toBe(IAT + 60 * 60 * 24)
  })

  it('rejects a TAMPERED token (payload escalated, original signature kept)', async () => {
    // The exact attack we must defeat: take a valid `pro` token and rewrite the
    // payload to `enterprise`, keeping the original signature.
    const token = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT, plan: 'pro' })
    const [h, p, s] = token.split('.')
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>
    payload.plan = 'enterprise'
    payload.capabilities = ['scenario.stepDebug', 'sso', 'scim']
    const forgedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const tampered = `${h}.${forgedPayload}.${s}`
    await expect(verifyEntitlementToken(tampered, keys.publicSpkiPem, { now: at(60) })).rejects.toThrow()
  })

  it('rejects a token signed by a DIFFERENT key (wrong key)', async () => {
    const other = await generateEdKeyPair()
    const token = await signEntitlement({ privateKey: other.privateKey, iatSeconds: IAT })
    await expect(verifyEntitlementToken(token, keys.publicSpkiPem, { now: at(60) })).rejects.toThrow()
  })

  it('rejects a token NOT signed by the embedded DEV key', async () => {
    // Forge-resistance against the real embedded key: an attacker without the
    // DEV private key cannot mint anything the app will accept.
    const token = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    await expect(
      verifyEntitlementToken(token, entitlementPublicKeyPem('preview'), { now: at(60) })
    ).rejects.toThrow()
  })

  it('rejects an HS256 / alg-confusion token (algorithms pinned to EdDSA)', async () => {
    // A token whose header claims HS256 must never verify against the EdDSA key.
    const token = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT, alg: 'EdDSA' })
    // Re-encode header to HS256 to simulate an alg swap; the pinned verify must reject.
    const [, p, s] = token.split('.')
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const forged = `${forgedHeader}.${p}.${s}`
    await expect(verifyEntitlementToken(forged, keys.publicSpkiPem, { now: at(60) })).rejects.toThrow()
  })

  it('rejects a wrong-audience token (token-confusion guard)', async () => {
    const token = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      audience: 'restorm-session'
    })
    await expect(verifyEntitlementToken(token, keys.publicSpkiPem, { now: at(60) })).rejects.toThrow()
  })

  it('rejects a token past its exp (grace ceiling), even with a valid signature', async () => {
    const token = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      graceSeconds: 100
    })
    // now = iat + 200s > exp (iat + 100s)
    await expect(verifyEntitlementToken(token, keys.publicSpkiPem, { now: at(200) })).rejects.toThrow()
  })

  it('matches the backend audience constant', () => {
    expect(ENTITLEMENT_AUDIENCE).toBe('restorm-entitlement')
  })
})

describe('grace / refresh arithmetic', () => {
  const claims = { exp: IAT + 60 * 60 * 24 * 15, refreshAfter: IAT + 60 * 60 * 24 }

  it('isWithinGrace is true before exp and false at/after it', () => {
    expect(isWithinGrace(claims, IAT + 60 * 60 * 24 * 14)).toBe(true)
    expect(isWithinGrace(claims, claims.exp)).toBe(false)
    expect(isWithinGrace(claims, claims.exp + 1)).toBe(false)
  })

  it('needsRefresh is false before refreshAfter and true at/after it', () => {
    expect(needsRefresh(claims, IAT + 60 * 60 * 12)).toBe(false)
    expect(needsRefresh(claims, claims.refreshAfter)).toBe(true)
    expect(needsRefresh(claims, claims.refreshAfter + 1)).toBe(true)
  })
})

describe('fetchEntitlement', () => {
  it('sends the session JWT as a bearer token and returns the parsed body', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const fetchImpl = ((url: string, init?: RequestInit) => {
      seenUrl = url
      seenAuth = (init?.headers as Record<string, string>).authorization
      return Promise.resolve(new Response(JSON.stringify({ entitlement: 'signed.jwt.here', plan: 'pro' }), { status: 200 }))
    }) as unknown as typeof fetch

    const body = await fetchEntitlement('https://x.supabase.co/functions/v1/entitlement', 'session-jwt', fetchImpl)
    expect(seenUrl).toContain('/entitlement')
    expect(seenAuth).toBe('Bearer session-jwt')
    expect(body.entitlement).toBe('signed.jwt.here')
  })

  it('throws on a non-2xx response', async () => {
    const fetchImpl = (() => Promise.resolve(new Response('nope', { status: 401 }))) as unknown as typeof fetch
    await expect(
      fetchEntitlement('https://x.supabase.co/functions/v1/entitlement', 'jwt', fetchImpl)
    ).rejects.toThrow()
  })

  it('throws when the body lacks a signed token', async () => {
    const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ plan: 'pro' }), { status: 200 }))) as unknown as typeof fetch
    await expect(
      fetchEntitlement('https://x.supabase.co/functions/v1/entitlement', 'jwt', fetchImpl)
    ).rejects.toThrow()
  })
})
