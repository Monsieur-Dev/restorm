import { describe, it, expect } from 'vitest'
import { KeyValue } from './KeyValue'
import { SecretValue } from '../../types/valueTypes/SecretValue'
import { serializeValueForPersistence } from '../../utils/valuePersistence'

describe('KeyValue round-trip — secret', () => {
  it('fromPlain constructs a SecretValue from persisted shape', () => {
    const kv = KeyValue.fromPlain({ key: 'Authorization', value: { type: 'secret', source: 'envVar', params: { name: 'API_TOKEN' } } })
    expect(kv.value).toBeInstanceOf(SecretValue)
    const sv = kv.value as SecretValue
    expect(sv.source).toBe('envVar')
    expect(sv.params).toEqual({ name: 'API_TOKEN' })
  })

  it('preserves the secret discriminant (never degrades to StringValue) even with a missing source', () => {
    const kv = KeyValue.fromPlain({ key: 'k', value: { type: 'secret', params: { name: 'X' } } })
    expect(kv.value).toBeInstanceOf(SecretValue)
    expect((kv.value as SecretValue).params).toEqual({ name: 'X' })
  })

  it('round-trip: fromPlain → serialize never includes resolved', () => {
    const kv = KeyValue.fromPlain({ key: 'k', value: { type: 'secret', source: 'envVar', params: { name: 'X' } } })
    const sv = kv.value as SecretValue
    sv.resolved = 'should-not-appear'
    expect(serializeValueForPersistence(kv.value)).toEqual({ type: 'secret', source: 'envVar', params: { name: 'X' } })
  })

  it('accepts a SecretValue instance in the instanceof allowlist', () => {
    const sv = new SecretValue('envVar', { name: 'Y' })
    const kv = KeyValue.fromPlain({ key: 'k', value: sv })
    expect(kv.value).toBe(sv)
  })

  it('coerces a non-string source to empty string but keeps it a SecretValue', () => {
    const kv = KeyValue.fromPlain({ key: 'k', value: { type: 'secret', source: 123, params: {} } })
    const sv = kv.value as SecretValue
    expect(sv).toBeInstanceOf(SecretValue)
    expect(sv.source).toBe('')
  })

  it('coerces missing params to empty object', () => {
    const kv = KeyValue.fromPlain({ key: 'k', value: { type: 'secret', source: 'envVar', params: 'bad' } })
    const sv = kv.value as SecretValue
    expect(sv.params).toEqual({})
  })
})

describe('KeyValue rehydration — in-memory resolved plaintext', () => {
  it('carries `resolved` through fromPlain (the sidecar loader stamps it before rehydration)', () => {
    const kv = KeyValue.fromPlain({ key: 'secret', value: { type: 'secret', source: 'envFileSecret', params: { key: 'EnvF/Dev/secret' }, resolved: 's3cr3t' } })
    const sv = kv.value as SecretValue
    expect(sv).toBeInstanceOf(SecretValue)
    expect(sv.resolved).toBe('s3cr3t')
  })

  it('still strips `resolved` from persistence (memory-only field)', () => {
    const kv = KeyValue.fromPlain({ key: 'secret', value: { type: 'secret', source: 'envFileSecret', params: {}, resolved: 's3cr3t' } })
    expect(JSON.parse(JSON.stringify(kv.value)) as Record<string, unknown>).not.toHaveProperty('resolved')
  })

  it('leaves `resolved` unset when absent or empty', () => {
    const kv = KeyValue.fromPlain({ key: 'k', value: { type: 'secret', source: 'envFileSecret', params: {}, resolved: '' } })
    expect((kv.value as SecretValue).resolved).toBeUndefined()
  })
})
