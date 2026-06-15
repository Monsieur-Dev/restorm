import { describe, it, expect } from 'vitest'
import { SecretValue } from './SecretValue'

describe('SecretValue', () => {
  it('holds source+params, toJSON strips resolved value', () => {
    const v = new SecretValue('envVar', { name: 'GH_TOKEN' })
    v.resolved = 'super-secret'
    expect(v.type).toBe('secret')
    expect(v.source).toBe('envVar')
    expect(v.params).toEqual({ name: 'GH_TOKEN' })
    expect(JSON.parse(JSON.stringify(v))).toEqual({ type: 'secret', source: 'envVar', params: { name: 'GH_TOKEN' } })
    expect(v.toString()).toBe('super-secret')
  })

  it('toString returns empty string when resolved is not set', () => {
    const v = new SecretValue('envVar', { name: 'X' })
    expect(v.toString()).toBe('')
  })

  it('defaults params to empty object', () => {
    const v = new SecretValue('envVar')
    expect(v.params).toEqual({})
  })

  it('toJSON never includes resolved even when set', () => {
    const v = new SecretValue('envVar', { name: 'LEAK' })
    v.resolved = 'DO_NOT_PERSIST'
    const json = v.toJSON()
    expect(json).not.toHaveProperty('resolved')
    expect(Object.keys(json)).toEqual(['type', 'source', 'params'])
  })
})
