import { describe, it, expect } from 'vitest'
import { applyCrypto, isCryptoOp, CRYPTO_OPS, cryptoOpNeedsKey, cryptoOpNeedsInput } from './scenarioCrypto'

describe('scenarioCrypto — the one crypto core (runtime + preview)', () => {
  it('base64 round-trips UTF-8', () => {
    expect(applyCrypto('hello', 'base64Encode')).toBe('aGVsbG8=')
    expect(applyCrypto('aGVsbG8=', 'base64Decode')).toBe('hello')
    // non-ASCII survives the round-trip
    const enc = applyCrypto('héllo €', 'base64Encode')
    expect(applyCrypto(enc, 'base64Decode')).toBe('héllo €')
  })

  it('base64Decode of non-UTF-8 bytes THROWS (→ error port)', () => {
    // Valid base64 of bytes that are not a valid UTF-8 sequence (0xFF 0xFE).
    expect(() => applyCrypto('//4=', 'base64Decode')).toThrow()
  })

  it('hashes produce the canonical lower-case hex digests', () => {
    expect(applyCrypto('abc', 'md5')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(applyCrypto('abc', 'sha1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(applyCrypto('abc', 'sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(applyCrypto('abc', 'sha512')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
    )
  })

  it('hmacSha256 matches the RFC-4231-style known vector and needs a key', () => {
    // HMAC-SHA256("The quick brown fox jumps over the lazy dog", key="key")
    expect(applyCrypto('The quick brown fox jumps over the lazy dog', 'hmacSha256', 'key')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    )
    expect(() => applyCrypto('x', 'hmacSha256', '')).toThrow(/key/)
  })

  it('non-string operands coerce deterministically (number / object hash the same as their text/JSON)', () => {
    expect(applyCrypto(123, 'sha256')).toBe(applyCrypto('123', 'sha256'))
    expect(applyCrypto({ a: 1 }, 'sha256')).toBe(applyCrypto('{"a":1}', 'sha256'))
  })

  it('uuid generates a fresh RFC-4122 v4 each call (ignores input)', () => {
    const a = applyCrypto(null, 'uuid')
    const b = applyCrypto('ignored', 'uuid')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })

  it('op metadata: which ops need a key / an input', () => {
    expect(CRYPTO_OPS).toContain('sha256')
    expect(isCryptoOp('sha256')).toBe(true)
    expect(isCryptoOp('sha384')).toBe(false)
    expect(cryptoOpNeedsKey('hmacSha256')).toBe(true)
    expect(cryptoOpNeedsKey('sha256')).toBe(false)
    expect(cryptoOpNeedsInput('uuid')).toBe(false)
    expect(cryptoOpNeedsInput('base64Encode')).toBe(true)
  })
})
