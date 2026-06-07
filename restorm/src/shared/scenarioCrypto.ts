/**
 * Pure crypto core for the scenario `crypto` node — the ONE implementation the
 * RUNTIME (`cryptoExecutor`) and the INSPECTOR PREVIEW (`scenarioStaticPreview`)
 * both call, so the two can never drift (same pattern as `scenarioComparison` /
 * `scenarioCast` / `scenarioRegex` / `scenarioJson`).
 *
 * Built on `crypto-js` — synchronous AND isomorphic (runs identically in the
 * main process and the renderer), unlike the async Web Crypto `subtle.digest`
 * which the sync static-preview path cannot await. `uuid` is the one exception:
 * it has no input and is intrinsically non-deterministic, produced by the
 * platform `crypto.randomUUID()` (present in both Node and the renderer).
 *
 * `applyCrypto` THROWS on invalid input — an `hmacSha256` with no key, or a
 * `base64Decode` of a non-base64 / non-UTF-8 string. The runtime routes that to
 * the `error` port; the preview catches it into "no result".
 */
import CryptoJS from 'crypto-js'

/** The operations a `crypto` node can run. */
export type CryptoOp =
  | 'base64Encode'
  | 'base64Decode'
  | 'md5'
  | 'sha1'
  | 'sha256'
  | 'sha512'
  | 'hmacSha256'
  | 'uuid'

export const CRYPTO_OPS: readonly CryptoOp[] = [
  'base64Encode',
  'base64Decode',
  'md5',
  'sha1',
  'sha256',
  'sha512',
  'hmacSha256',
  'uuid'
]

export const isCryptoOp = (v: unknown): v is CryptoOp =>
  typeof v === 'string' && (CRYPTO_OPS as readonly string[]).includes(v)

/** Ops that read a secret `key` (HMAC). */
export const CRYPTO_OPS_NEEDING_KEY: readonly CryptoOp[] = ['hmacSha256']
/** Ops that ignore the `value` input (they generate, not transform). */
export const CRYPTO_OPS_NO_INPUT: readonly CryptoOp[] = ['uuid']

export const cryptoOpNeedsKey = (op: CryptoOp): boolean => CRYPTO_OPS_NEEDING_KEY.includes(op)
export const cryptoOpNeedsInput = (op: CryptoOp): boolean => !CRYPTO_OPS_NO_INPUT.includes(op)

/** Coerce any operand into the string the hash/encode runs over: a string stays
 * itself; a number / boolean stringifies; an object / array becomes its JSON
 * (so hashing a structure is stable); null / undefined become the empty string. */
function toInputString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (v === null || v === undefined) return ''
  return JSON.stringify(v)
}

/**
 * Run `op` over `value` (+ `key` for HMAC).
 *
 * - **base64Encode / base64Decode**: UTF-8 ⇄ base64. A non-base64 / non-UTF-8
 *   input to decode THROWS.
 * - **md5 / sha1 / sha256 / sha512**: lower-case hex digest.
 * - **hmacSha256**: keyed SHA-256, lower-case hex. An empty `key` THROWS.
 * - **uuid**: a fresh RFC-4122 v4 UUID (ignores `value`).
 */
export function applyCrypto(value: unknown, op: CryptoOp, key = ''): string {
  if (op === 'uuid') return globalThis.crypto.randomUUID()

  const input = toInputString(value)
  switch (op) {
    case 'base64Encode':
      return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(input))
    case 'base64Decode':
      // `Utf8.stringify` throws "Malformed UTF-8 data" on bytes that aren't a
      // valid UTF-8 string — i.e. the input wasn't base64 of UTF-8 text.
      return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(input))
    case 'md5':
      return CryptoJS.MD5(input).toString()
    case 'sha1':
      return CryptoJS.SHA1(input).toString()
    case 'sha256':
      return CryptoJS.SHA256(input).toString()
    case 'sha512':
      return CryptoJS.SHA512(input).toString()
    case 'hmacSha256':
      if (!key) throw new Error('hmac-sha256 requires a non-empty key')
      return CryptoJS.HmacSHA256(input, key).toString()
  }
}
