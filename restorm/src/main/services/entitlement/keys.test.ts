// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { entitlementPublicKeyPem, isEntitlementPublicKeyConfigured } from './keys'
import { importEntitlementPublicKey } from 'electron-core-ui/main'

describe('entitlement keys', () => {
  it('the embedded DEV (preview) key is a real, importable Ed25519 SPKI key', async () => {
    const pem = entitlementPublicKeyPem('preview')
    expect(pem).toContain('BEGIN PUBLIC KEY')
    // Must import as an Ed25519 key — proves it is a well-formed SPKI key the
    // verifier can actually use offline.
    await expect(importEntitlementPublicKey(pem)).resolves.toBeDefined()
    expect(isEntitlementPublicKeyConfigured('preview')).toBe(true)
  })

  it('the prod key is still a placeholder (fails closed until generated)', () => {
    expect(isEntitlementPublicKeyConfigured('prod')).toBe(false)
  })
})
