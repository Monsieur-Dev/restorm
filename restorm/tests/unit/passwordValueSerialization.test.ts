/**
 * Invariant tests for `PasswordValue` serialization hygiene.
 *
 * The crash-recovery draft flow and the decomposer flow both hit
 * `JSON.stringify` on the live tree. If a `PasswordValue` instance
 * ever emits its plaintext through that pipeline, a user's password
 * ends up on disk under `userData/drafts/<uuid>/…`. Keeping this
 * test green is the simplest way to catch a regression.
 */

import { describe, it, expect } from 'vitest'
import { PasswordValue } from '../../src/shared/types/valueTypes/PasswordValue'
import { StringValue } from '../../src/shared/types/valueTypes/StringValue'
import { KeyValue } from '../../src/shared/models/KeyValue'

describe('PasswordValue — serialization hygiene', () => {
  it('`toJSON()` returns only the type discriminator, never the plaintext', () => {
    const pw = new PasswordValue('super-secret-42')
    const json = pw.toJSON()
    expect(json).toEqual({ type: 'password' })
    expect(Object.keys(json)).not.toContain('value')
  })

  it('the in-memory `.value` field stays accessible for .env collection', () => {
    const pw = new PasswordValue('still-secret')
    // `collectPasswordSecretsFromCollections` reads `.value` directly.
    expect(pw.value).toBe('still-secret')
  })

  it('`JSON.stringify` emits the password-free shape', () => {
    const pw = new PasswordValue('totally-secret')
    const serialized = JSON.stringify(pw)
    expect(serialized).toBe('{"type":"password"}')
    expect(serialized).not.toContain('totally-secret')
  })

  it('`JSON.stringify` on a parent object strips nested passwords transparently', () => {
    const keyValue = new KeyValue({
      key: 'X-Api-Key',
      value: new PasswordValue('leak-me-if-you-can')
    })
    const serialized = JSON.stringify(keyValue)
    expect(serialized).not.toContain('leak-me-if-you-can')
    const roundTripped = JSON.parse(serialized) as { key: string; value: { type: string; value?: string } }
    expect(roundTripped.key).toBe('X-Api-Key')
    expect(roundTripped.value).toEqual({ type: 'password' })
  })

  it('a KeyValue with a non-PasswordValue is unaffected', () => {
    const keyValue = new KeyValue({
      key: 'X-Public',
      value: new StringValue('public-value')
    })
    const serialized = JSON.stringify(keyValue)
    expect(serialized).toContain('public-value')
  })

  it('a mixed headers array safely round-trips through JSON without leaking secrets', () => {
    const headers = [
      new KeyValue({ key: 'Authorization', value: new PasswordValue('bearer-xyz-123') }),
      new KeyValue({ key: 'X-Trace', value: new StringValue('trace-abc') })
    ]
    const serialized = JSON.stringify(headers)
    expect(serialized).not.toContain('bearer-xyz-123')
    expect(serialized).toContain('trace-abc')
  })
})
