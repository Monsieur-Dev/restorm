/**
 * Secure persistence of the auth tokens.
 *
 * We persist the long-lived session JWT and the cached entitlement JWT to a file
 * under `userData` so a sign-in survives restarts and the entitlement is usable
 * offline within its grace window. The session JWT is a 30-day bearer credential,
 * so at rest it is ENCRYPTED with the OS keychain via electron `safeStorage`
 * (DPAPI / Keychain / libsecret). When the platform has no encryption backend
 * (e.g. a headless Linux box with no keyring) we fall back to a 0600 plaintext
 * file and log a warning — the session is no more exposed than the user's own
 * home directory, and refusing to persist would break offline use entirely.
 *
 * The `safeStorage` and filesystem dependencies are injected as narrow ports so
 * this module references no electron symbol and is unit-testable with fakes.
 */

/** Narrow slice of electron `safeStorage`. */
export interface SecureStoragePort {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

/** Narrow filesystem port (sync, mode-aware). */
export interface AuthStoreFs {
  read: (filePath: string) => Buffer | null
  /** Write atomically-enough with restrictive permissions (0600). */
  write: (filePath: string, data: Buffer) => void
  remove: (filePath: string) => void
}

/** What we persist. The entitlement may be absent (signed in but never polled). */
export interface PersistedAuth {
  sessionToken: string
  entitlementToken: string | null
}

/** On-disk envelope (so we know whether the payload is encrypted). */
interface Envelope {
  v: 1
  enc: boolean
  data: string
}

function isPersistedAuth(value: unknown): value is PersistedAuth {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v['sessionToken'] === 'string' &&
    (v['entitlementToken'] === null || typeof v['entitlementToken'] === 'string')
}

export class AuthStore {
  constructor(
    private readonly filePath: string,
    private readonly storage: SecureStoragePort,
    private readonly fs: AuthStoreFs,
    private readonly log: (msg: string, fields?: Record<string, unknown>) => void = () => undefined
  ) {}

  /** Load the persisted auth, or `null` when absent / unreadable / encrypted on a
   * machine that can no longer decrypt it. Never throws. */
  load(): PersistedAuth | null {
    const raw = this.fs.read(this.filePath)
    if (!raw) return null
    try {
      const envelope = JSON.parse(raw.toString('utf8')) as Envelope
      let json: string
      if (envelope.enc) {
        if (!this.storage.isEncryptionAvailable()) {
          this.log('auth: cached session is encrypted but no decryption backend is available; ignoring')
          return null
        }
        json = this.storage.decryptString(Buffer.from(envelope.data, 'base64'))
      } else {
        json = envelope.data
      }
      const parsed: unknown = JSON.parse(json)
      return isPersistedAuth(parsed) ? parsed : null
    } catch (err) {
      this.log('auth: failed to read cached session; ignoring', {
        message: err instanceof Error ? err.message : String(err)
      })
      return null
    }
  }

  /** Persist the auth tokens, encrypted when a backend is available. */
  save(data: PersistedAuth): void {
    const json = JSON.stringify(data)
    let envelope: Envelope
    if (this.storage.isEncryptionAvailable()) {
      envelope = { v: 1, enc: true, data: this.storage.encryptString(json).toString('base64') }
    } else {
      this.log('auth: OS encryption unavailable; persisting session token unencrypted (0600)')
      envelope = { v: 1, enc: false, data: json }
    }
    this.fs.write(this.filePath, Buffer.from(JSON.stringify(envelope), 'utf8'))
  }

  /** Remove the persisted auth (logout). */
  clear(): void {
    this.fs.remove(this.filePath)
  }
}
