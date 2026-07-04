import { describe, it, expect } from 'vitest'
import { getRedisCommandFields, REDIS_COMMAND_FIELDS } from './redisCommandFields'

describe('getRedisCommandFields', () => {
  it('gives GET a single fixed "key" field, no repeatable tail', () => {
    expect(getRedisCommandFields('GET')).toEqual({ fixed: [{ key: 'key', labelKey: 'redis.fields.key' }] })
  })

  it('gives SET fixed key + value fields', () => {
    expect(getRedisCommandFields('SET').fixed.map((f) => f.key)).toEqual(['key', 'value'])
  })

  it('gives HSET fixed key + field + value fields', () => {
    expect(getRedisCommandFields('HSET').fixed.map((f) => f.key)).toEqual(['key', 'field', 'value'])
  })

  it('gives DEL no fixed fields and a repeatable "key" tail (variable arity)', () => {
    const spec = getRedisCommandFields('DEL')
    expect(spec.fixed).toEqual([])
    expect(spec.repeatable?.labelKey).toBe('redis.fields.key')
  })

  it('gives LPUSH/RPUSH a fixed key plus a repeatable "value" tail', () => {
    expect(getRedisCommandFields('LPUSH')).toEqual({ fixed: [{ key: 'key', labelKey: 'redis.fields.key' }], repeatable: { labelKey: 'redis.fields.value' } })
    expect(getRedisCommandFields('RPUSH')).toEqual({ fixed: [{ key: 'key', labelKey: 'redis.fields.key' }], repeatable: { labelKey: 'redis.fields.value' } })
  })

  it('gives XADD fixed key + id plus a repeatable field/value tail', () => {
    const spec = getRedisCommandFields('XADD')
    expect(spec.fixed.map((f) => f.key)).toEqual(['key', 'id'])
    expect(spec.repeatable?.labelKey).toBe('redis.fields.fieldOrValue')
  })

  it('falls back to a generic repeatable per-arg list for XREAD (irregular grammar)', () => {
    expect(getRedisCommandFields('XREAD')).toEqual({ fixed: [], repeatable: { labelKey: 'redis.fields.argument' } })
  })

  it('falls back to the generic list for an unknown/unset command', () => {
    expect(getRedisCommandFields(undefined)).toEqual({ fixed: [], repeatable: { labelKey: 'redis.fields.argument' } })
    expect(getRedisCommandFields('NOTACOMMAND')).toEqual({ fixed: [], repeatable: { labelKey: 'redis.fields.argument' } })
  })

  it('covers every command in the app palette with either a fixed or a repeatable layout', () => {
    for (const spec of Object.values(REDIS_COMMAND_FIELDS)) {
      expect(spec.fixed.length > 0 || spec.repeatable !== undefined).toBe(true)
    }
  })
})
