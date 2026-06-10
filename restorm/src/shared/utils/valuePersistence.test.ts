import { describe, it, expect } from 'vitest'
import { serializeValueForPersistence } from './valuePersistence'
import { EnvironmentValue, VariableValue, ListValue, NumericValue, StringValue } from '../types/collections'

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

describe('serializeValueForPersistence — list', () => {
  it('serializes a ListValue recursively (a list can nest lists)', () => {
    const inner = new ListValue([new NumericValue(1, 'decimal')])
    const value = new ListValue([new StringValue('a'), new VariableValue('x'), inner])
    expect(serializeValueForPersistence(value)).toEqual({
      type: 'list',
      items: [
        { type: 'string', value: 'a' },
        { type: 'variable', value: 'x' },
        { type: 'list', items: [{ type: 'numeric', value: 1, format: 'decimal' }] }
      ]
    })
  })

  it('round-trips an already-persisted list object (idempotent, recursive)', () => {
    const persisted = {
      type: 'list',
      items: [{ type: 'string', value: 'a' }, { type: 'list', items: [{ type: 'null' }] }]
    }
    expect(serializeValueForPersistence(persisted)).toEqual(persisted)
  })

  it('serializes an empty list', () => {
    expect(serializeValueForPersistence(new ListValue([]))).toEqual({ type: 'list', items: [] })
  })
})
