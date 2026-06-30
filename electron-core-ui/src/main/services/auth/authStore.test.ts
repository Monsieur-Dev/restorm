// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { AuthStore, type AuthStoreFs, type SecureStoragePort, type PersistedAuth } from './authStore'

/** In-memory fs. */
function makeFs(): AuthStoreFs & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    read: (p) => files.get(p) ?? null,
    write: (p, data) => { files.set(p, data) },
    remove: (p) => { files.delete(p) }
  }
}

/** Fake safeStorage. `available=false` exercises the plaintext fallback. The
 * "encryption" is a reversible XOR-ish marker — enough to prove the data is not
 * stored verbatim and round-trips. */
function makeStorage(available: boolean): SecureStoragePort {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`ENC:${s}`, 'utf8'),
    decryptString: (b) => b.toString('utf8').replace(/^ENC:/, '')
  }
}

const FILE = '/userData/auth-session.dat'
const sample: PersistedAuth = { sessionToken: 'sess.jwt.tok', entitlementToken: 'ent.jwt.tok' }

describe('AuthStore', () => {
  it('round-trips through the encrypted path and does not store the token verbatim', () => {
    const fs = makeFs()
    const store = new AuthStore(FILE, makeStorage(true), fs)
    store.save(sample)

    const onDisk = (fs.files.get(FILE) ?? Buffer.alloc(0)).toString('utf8')
    expect(onDisk).toContain('"enc":true')
    expect(onDisk).not.toContain('sess.jwt.tok') // ciphertext, not the raw token

    expect(store.load()).toEqual(sample)
  })

  it('falls back to a plaintext envelope when no encryption backend is available', () => {
    const fs = makeFs()
    const store = new AuthStore(FILE, makeStorage(false), fs)
    store.save(sample)
    expect((fs.files.get(FILE) ?? Buffer.alloc(0)).toString('utf8')).toContain('"enc":false')
    expect(store.load()).toEqual(sample)
  })

  it('returns null when an encrypted blob cannot be decrypted on this machine', () => {
    const fs = makeFs()
    new AuthStore(FILE, makeStorage(true), fs).save(sample)
    // A later run with NO encryption backend can't read the encrypted blob.
    const store2 = new AuthStore(FILE, makeStorage(false), fs)
    expect(store2.load()).toBeNull()
  })

  it('returns null for a missing file and never throws on corrupt content', () => {
    const fs = makeFs()
    const store = new AuthStore(FILE, makeStorage(true), fs)
    expect(store.load()).toBeNull()
    fs.files.set(FILE, Buffer.from('not json at all', 'utf8'))
    expect(store.load()).toBeNull()
  })

  it('clear removes the persisted file', () => {
    const fs = makeFs()
    const store = new AuthStore(FILE, makeStorage(true), fs)
    store.save(sample)
    store.clear()
    expect(fs.files.has(FILE)).toBe(false)
    expect(store.load()).toBeNull()
  })

  it('persists a null entitlement (signed in, never polled)', () => {
    const fs = makeFs()
    const store = new AuthStore(FILE, makeStorage(true), fs)
    store.save({ sessionToken: 's', entitlementToken: null })
    expect(store.load()).toEqual({ sessionToken: 's', entitlementToken: null })
  })
})
