import { describe, it, expect } from 'vitest'
import { serializeValueForPersistence } from './valuePersistence'
import { EnvironmentValue, VariableValue } from '../types/collections'

describe('serializeValueForPersistence — environment', () => {
  it('serializes an EnvironmentValue instance to its persisted shape', () => {
    expect(serializeValueForPersistence(new EnvironmentValue('env-123'))).toEqual({
      type: 'environment',
      value: 'env-123'
    })
  })

  it('round-trips an already-persisted environment object (idempotent)', () => {
    const persisted = { type: 'environment', value: 'env-123' }
    expect(serializeValueForPersistence(persisted)).toEqual(persisted)
  })

  it('coerces a malformed environment value to an empty string', () => {
    expect(serializeValueForPersistence({ type: 'environment', value: 42 })).toEqual({
      type: 'environment',
      value: ''
    })
  })

  it('keeps environment distinct from variable (no cross-contamination)', () => {
    expect(serializeValueForPersistence(new VariableValue('v'))).toEqual({ type: 'variable', value: 'v' })
    expect(serializeValueForPersistence(new EnvironmentValue('v'))).toEqual({ type: 'environment', value: 'v' })
  })
})
