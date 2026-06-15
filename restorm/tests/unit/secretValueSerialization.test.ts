/**
 * Invariant tests for `SecretValue` serialization hygiene.
 *
 * The crash-recovery draft flow and the decomposer flow both hit
 * `JSON.stringify` on the live tree. The in-memory plaintext rides on
 * `SecretValue.resolved` (a non-persisted field). If it ever emits
 * through that pipeline, a user's secret ends up on disk under
 * `userData/drafts/<uuid>/…`. Keeping this test green catches a regression.
 */

import { describe, it, expect } from 'vitest'
import { SecretValue } from '../../src/shared/types/valueTypes/SecretValue'
import { StringValue } from '../../src/shared/types/valueTypes/StringValue'
import { KeyValue } from '../../src/shared/models/KeyValue'

describe('SecretValue — serialization hygiene', () => {
  it('`toJSON()` returns the canonical shape, never the resolved plaintext', () => {
    const secret = new SecretValue('envFileSecret', { key: 'My API/headers/Authorization' })
    secret.resolved = 'super-secret-42'
    const json = secret.toJSON()
    expect(json).toEqual({
      type: 'secret',
      source: 'envFileSecret',
      params: { key: 'My API/headers/Authorization' }
    })
    expect(Object.keys(json)).not.toContain('resolved')
  })

  it('`JSON.stringify` emits the resolved-free shape', () => {
    const secret = new SecretValue('envVar', { name: 'GH_TOKEN' })
    secret.resolved = 'totally-secret'
    const serialized = JSON.stringify(secret)
    expect(serialized).not.toContain('totally-secret')
    expect(JSON.parse(serialized)).toEqual({
      type: 'secret',
      source: 'envVar',
      params: { name: 'GH_TOKEN' }
    })
  })

  it('`JSON.stringify` on a parent object strips nested resolved plaintext transparently', () => {
    const secret = new SecretValue('envFileSecret', { key: 'k' })
    secret.resolved = 'leak-me-if-you-can'
    const keyValue = new KeyValue({ key: 'X-Api-Key', value: secret })
    const serialized = JSON.stringify(keyValue)
    expect(serialized).not.toContain('leak-me-if-you-can')
    const roundTripped = JSON.parse(serialized) as {
      key: string
      value: { type: string; source: string; params: Record<string, unknown> }
    }
    expect(roundTripped.key).toBe('X-Api-Key')
    expect(roundTripped.value).toEqual({ type: 'secret', source: 'envFileSecret', params: { key: 'k' } })
  })

  it('a KeyValue holding a SecretValue round-trips through fromPlain without a resolved field', () => {
    const secret = new SecretValue('envVar', { name: 'API_KEY' })
    secret.resolved = 'do-not-persist'
    const original = new KeyValue({ key: 'Authorization', value: secret })

    const serialized = JSON.stringify(original)
    expect(serialized).not.toContain('do-not-persist')

    const restored = KeyValue.fromPlain(JSON.parse(serialized) as { key: string; value: unknown })
    expect(restored.value).toBeInstanceOf(SecretValue)
    const restoredSecret = restored.value as SecretValue
    expect(restoredSecret.source).toBe('envVar')
    expect(restoredSecret.params).toEqual({ name: 'API_KEY' })
    // Plaintext was never persisted, so the reloaded secret has no resolved value.
    expect(restoredSecret.resolved).toBeUndefined()
  })

  it('a KeyValue with a non-secret value is unaffected', () => {
    const keyValue = new KeyValue({ key: 'X-Public', value: new StringValue('public-value') })
    const serialized = JSON.stringify(keyValue)
    expect(serialized).toContain('public-value')
  })

  it('a mixed headers array safely round-trips through JSON without leaking secrets', () => {
    const secret = new SecretValue('envVar', { name: 'TOKEN' })
    secret.resolved = 'bearer-xyz-123'
    const headers = [
      new KeyValue({ key: 'Authorization', value: secret }),
      new KeyValue({ key: 'X-Trace', value: new StringValue('trace-abc') })
    ]
    const serialized = JSON.stringify(headers)
    expect(serialized).not.toContain('bearer-xyz-123')
    expect(serialized).toContain('trace-abc')
  })
})
