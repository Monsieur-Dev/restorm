import { describe, it, expect } from 'vitest'
import { validateAgainstSchema } from './schemaValidate'

const PET_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'number' }, name: { type: 'string' } }
})

describe('validateAgainstSchema', () => {
  it('passes a conforming value', () => {
    expect(validateAgainstSchema({ id: 1, name: 'Rex' }, PET_SCHEMA)).toEqual({ valid: true, errors: [] })
  })

  it('fails + reports errors for a non-conforming value', () => {
    const r = validateAgainstSchema({ id: 'oops' }, PET_SCHEMA)
    expect(r.valid).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('throws on a non-JSON schema', () => {
    expect(() => validateAgainstSchema({}, 'not json')).toThrow()
  })

  it('throws on a schema ajv rejects', () => {
    expect(() => validateAgainstSchema({}, JSON.stringify({ type: 'not-a-type' }))).toThrow()
  })
})
