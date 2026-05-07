import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openapi31ToApiDocumentation,
  normalizeSchema31To30,
  type OAS31Spec
} from '../../../../src/main/services/import/transformers/openapi31ToApiDocumentation'
import type { CommonSchema } from '../../../../src/main/services/import/transformers/_shared'

const FIXTURES = join(__dirname, '../../fixtures/openapi')
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'))

describe('normalizeSchema31To30', () => {
  it('flattens [type, "null"] into type + nullable: true', () => {
    const out = normalizeSchema31To30({ type: ['string', 'null'] })
    expect(out.type).toBe('string')
    expect(out.nullable).toBe(true)
  })

  it('leaves multi-non-null type arrays alone (genuinely union types)', () => {
    const out = normalizeSchema31To30({ type: ['string', 'integer'] })
    expect(out.type).toEqual(['string', 'integer'])
  })

  it('promotes plural examples to a singular example', () => {
    const out = normalizeSchema31To30({ type: 'string', examples: ['hi', 'there'] })
    expect(out.example).toBe('hi')
  })

  it('handles 3.1 named-examples shape ({ key: { value } })', () => {
    const out = normalizeSchema31To30({ type: 'string', examples: { greeting: { value: 'hello' } } as unknown as Record<string, unknown> })
    expect(out.example).toBe('hello')
  })

  it('does not overwrite an explicit `example` with `examples`', () => {
    const out = normalizeSchema31To30({ type: 'string', example: 'kept', examples: ['discarded'] })
    expect(out.example).toBe('kept')
  })

  it('recurses into properties / items / oneOf', () => {
    const schema: CommonSchema = {
      type: 'object',
      properties: {
        leaf: { type: ['string', 'null'] },
        list: { type: 'array', items: { type: ['integer', 'null'] } },
        union: { oneOf: [{ type: ['string', 'null'] }, { type: 'integer' }] }
      }
    }
    const out = normalizeSchema31To30(schema)
    expect(out.properties?.leaf?.nullable).toBe(true)
    expect(out.properties?.list?.items?.nullable).toBe(true)
    expect(out.properties?.union?.oneOf?.[0]?.nullable).toBe(true)
  })

  it('does not mutate the input', () => {
    const schema: CommonSchema = { type: ['string', 'null'] }
    normalizeSchema31To30(schema)
    expect(schema.type).toEqual(['string', 'null'])
    expect(schema.nullable).toBeUndefined()
  })
})

describe('openapi31ToApiDocumentation — petstore-3.1', () => {
  const spec = loadFixture('petstore-3.1.json') as OAS31Spec

  it('produces sourceType "openapi" (no separate 3.1 source type)', () => {
    const doc = openapi31ToApiDocumentation(spec)
    expect(doc.sourceType).toBe('openapi')
  })

  it('downcasts nullable types in models', () => {
    const doc = openapi31ToApiDocumentation(spec)
    const pet = doc.models.Pet
    expect(pet?.properties.find((p) => p.name === 'id')?.type).toBe('integer')
  })

  it('imports the `webhooks` block as documentation-only operations', () => {
    const doc = openapi31ToApiDocumentation(spec)
    const webhook = doc.operations.find((op) => op.operationId === 'petStatusChangedWebhook')
    expect(webhook).toBeDefined()
    expect(webhook?.extra?.documentationOnly).toBe(true)
    expect(webhook?.extra?.source).toBe('webhook')
    expect(webhook?.match.method).toBe('POST')
  })
})

describe('openapi31ToApiDocumentation — webhooks-only spec', () => {
  const spec = loadFixture('webhooks-3.1.json') as OAS31Spec

  it('produces a doc with only webhook operations', () => {
    const doc = openapi31ToApiDocumentation(spec)
    expect(doc.operations).toHaveLength(1)
    expect(doc.operations[0]?.operationId).toBe('newPetWebhook')
    expect(doc.operations[0]?.extra?.documentationOnly).toBe(true)
  })

  it('preserves the webhook marker when the operation also declares `x-*` extensions', () => {
    // Patch a webhook operation in-memory with an x-* extension and
    // re-run the transformer. Without the merge in operation `extra`
    // the marker would be clobbered by the extensions write.
    const patched: OAS31Spec = JSON.parse(JSON.stringify(spec)) as OAS31Spec
    const webhookEntry = Object.values(patched.webhooks ?? {})[0]
    const op = webhookEntry?.post ?? webhookEntry?.get
    if (!op) throw new Error('webhook fixture has no operation')
    ;(op as { 'x-codegen-request-body-name'?: string })['x-codegen-request-body-name'] = 'event'
    const doc = openapi31ToApiDocumentation(patched)
    const webhook = doc.operations[0]
    expect(webhook?.extra?.documentationOnly).toBe(true)
    expect(webhook?.extra?.source).toBe('webhook')
    expect(webhook?.extra?.['x-codegen-request-body-name']).toBe('event')
  })
})
