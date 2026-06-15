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

  it('coerces missing source to empty string', () => {
    const kv = KeyValue.fromPlain({ key: 'k', value: { type: 'secret', source: 123, params: {} } })
    const sv = kv.value as SecretValue
    expect(sv.source).toBe('')
  })

  it('coerces missing params to empty object', () => {
    const kv = KeyValue.fromPlain({ key: 'k', value: { type: 'secret', source: 'envVar', params: 'bad' } })
    const sv = kv.value as SecretValue
    expect(sv.params).toEqual({})
  })
})
