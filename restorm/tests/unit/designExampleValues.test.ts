import { describe, it, expect } from 'vitest'
import {
  exampleValueSeed,
  generateExampleValue,
  resolveExampleValue,
  violatedConstraint
} from '../../src/shared/design/designExampleValues'
import { buildReferenceApiDesign } from './apiDesignReference'

// The seeded generator is a CONTRACT: the design server, the served
// docs and the doc-shots all derive the same auto values from the same
// (design, model, example, property) coordinates. These tests pin
// reproducibility and the type/format/constraint honouring — a change
// here silently changes every existing design's served examples.
describe('designExampleValues', () => {
  const design = buildReferenceApiDesign()
  const user = design.models.find((m) => m.id === 'model-user')
  const order = design.models.find((m) => m.id === 'model-order')
  if (user === undefined || order === undefined) throw new Error('reference fixture models missing')

  const prop = (modelId: 'model-user' | 'model-order', propId: string): (typeof user.properties)[number] => {
    const model = modelId === 'model-user' ? user : order
    const property = model.properties.find((p) => p.id === propId)
    if (property === undefined) throw new Error(`fixture property ${propId} missing`)
    return property
  }

  it('generates the SAME value for the same seed, on every call', () => {
    const seed = exampleValueSeed(design.id, user.id, 'example-x', 'prop-user-email')
    const first = generateExampleValue(design, user, prop('model-user', 'prop-user-email'), seed)
    const second = generateExampleValue(design, user, prop('model-user', 'prop-user-email'), seed)
    expect(second).toEqual(first)
  })

  it('changes the value when any seed coordinate changes', () => {
    const property = prop('model-user', 'prop-user-id')
    const base = generateExampleValue(design, user, property, exampleValueSeed(design.id, user.id, 'ex-1', property.id))
    const otherExample = generateExampleValue(design, user, property, exampleValueSeed(design.id, user.id, 'ex-2', property.id))
    expect(otherExample).not.toEqual(base)
  })

  it('honours string formats (uuid, email)', () => {
    const idValue = generateExampleValue(design, user, prop('model-user', 'prop-user-id'),
      exampleValueSeed(design.id, user.id, 'ex', 'prop-user-id'))
    expect(String(idValue)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    const emailValue = generateExampleValue(design, user, prop('model-user', 'prop-user-email'),
      exampleValueSeed(design.id, user.id, 'ex', 'prop-user-email'))
    expect(String(emailValue)).toMatch(/^[a-z]+\.[a-z]+@example\.com$/)
  })

  it('honours numeric constraints and integer-ness', () => {
    const property = {
      id: 'p-num',
      doc: { name: 'age', type: 'integer', required: false, constraints: { minimum: 18, maximum: 65 } }
    }
    const value = generateExampleValue(design, user, property, 'seed-num')
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(18)
    expect(value).toBeLessThanOrEqual(65)
  })

  it('honours length constraints on plain strings', () => {
    const property = {
      id: 'p-code',
      doc: { name: 'code', type: 'string', required: false, constraints: { minLength: 20, maxLength: 24 } }
    }
    const value = String(generateExampleValue(design, user, property, 'seed-code'))
    expect(value.length).toBeGreaterThanOrEqual(20)
    expect(value.length).toBeLessThanOrEqual(24)
  })

  it('picks a declared value for an enum-referenced property', () => {
    const value = generateExampleValue(design, user, prop('model-user', 'prop-user-status'),
      exampleValueSeed(design.id, user.id, 'ex', 'prop-user-status'))
    expect(['active', 'suspended', 'deleted']).toContain(value)
  })

  it('violatedConstraint reports the first broken constraint, null when conforming', () => {
    const email = prop('model-user', 'prop-user-email') // maxLength 254, pattern ^[^@]+@[^@]+$
    expect(violatedConstraint(email, 'ada@example.com')).toBeNull()
    expect(violatedConstraint(email, 'not-an-email')).toBe('pattern')
    expect(violatedConstraint(email, `${'x'.repeat(255)}@example.com`)).toBe('maxLength')

    const password = prop('model-user', 'prop-user-password') // minLength 12
    expect(violatedConstraint(password, 'short')).toBe('minLength')

    const bounded = { id: 'p', doc: { name: 'n', type: 'integer', required: false, constraints: { minimum: 1, maximum: 10 } } }
    expect(violatedConstraint(bounded, 0)).toBe('minimum')
    expect(violatedConstraint(bounded, 11)).toBe('maximum')
    expect(violatedConstraint(bounded, 5)).toBeNull()
  })

  it('resolveExampleValue prefers a defined value and tags provenance', () => {
    const example = user.examples?.[0]
    if (example === undefined) throw new Error('fixture example missing')

    const defined = resolveExampleValue(design, user, example, prop('model-user', 'prop-user-email'))
    expect(defined).toEqual({ value: 'admin@example.com', auto: false })

    const auto = resolveExampleValue(design, user, example, prop('model-user', 'prop-user-id'))
    expect(auto.auto).toBe(true)
    const again = resolveExampleValue(design, user, example, prop('model-user', 'prop-user-id'))
    expect(again.value).toEqual(auto.value)
  })
})
