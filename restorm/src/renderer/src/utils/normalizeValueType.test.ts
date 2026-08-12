import { describe, it, expect } from 'vitest'
import { normalizeValueType } from './normalizeValueType'
import { SecretValue } from '../../../shared/types/valueTypes/SecretValue'

describe('normalizeValueType — secret rehydration', () => {
  it('carries the in-memory `resolved` plaintext through rehydration', () => {
    // The sidecar loader stamps `.restorm.env` values onto the plain POJOs
    // BEFORE processAfterDeserialization rehydrates them — dropping the
    // field here would blank every sidecar-backed secret at open, and the
    // next save would overwrite the sidecar entry with "".
    const out = normalizeValueType({ type: 'secret', source: 'envFileSecret', params: { key: 'EnvF/Dev/secret' }, resolved: 's3cr3t' })
    expect(out).toBeInstanceOf(SecretValue)
    expect((out as SecretValue).resolved).toBe('s3cr3t')
  })

  it('leaves `resolved` unset when the POJO has none', () => {
    const out = normalizeValueType({ type: 'secret', source: 'envVar', params: { name: 'API_TOKEN' } })
    expect(out).toBeInstanceOf(SecretValue)
    expect((out as SecretValue).resolved).toBeUndefined()
  })
})
