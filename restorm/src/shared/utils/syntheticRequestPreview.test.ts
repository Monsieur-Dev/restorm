import { describe, expect, it } from 'vitest'
import { synthesizeOperationPreview } from './syntheticRequestPreview'
import type {
  ModelDocumentation,
  OperationDocumentation
} from '../types/apiDocumentation'

const baseOp = (over: Partial<OperationDocumentation>): OperationDocumentation => ({
  match: { urlPattern: '/pet/{petId}', method: 'GET' },
  ...over
})

describe('synthesizeOperationPreview', () => {
  it('prefers a response example over schema synthesis when both are present', () => {
    const op = baseOp({
      responses: {
        '200': {
          schema: 'Pet',
          examples: { 'application/json': { id: 7, name: 'Buddy' } }
        }
      },
      produces: ['application/json']
    })
    const models: Record<string, ModelDocumentation> = {
      Pet: { name: 'Pet', properties: [{ name: 'id', type: 'integer', required: true }] }
    }
    const out = synthesizeOperationPreview(op, models)
    expect(out?.response.body).toEqual({ id: 7, name: 'Buddy' })
    expect(out?.response.status).toBe(200)
    expect(out?.response.contentType).toBe('application/json')
  })

  it('walks the response schema when no example is provided, using property examples + format defaults', () => {
    const op = baseOp({
      responses: { '200': { schema: 'Pet' } },
      produces: ['application/json']
    })
    const models: Record<string, ModelDocumentation> = {
      Pet: {
        name: 'Pet',
        properties: [
          { name: 'id', type: 'integer', required: true },
          { name: 'name', type: 'string', required: true, example: 'Bella' },
          { name: 'born', type: 'string', format: 'date-time', required: false },
          { name: 'status', type: 'string', enumValues: ['available', 'sold'], required: false }
        ]
      }
    }
    const out = synthesizeOperationPreview(op, models)
    expect(out?.response.body).toEqual({
      id: 42,
      name: 'Bella',
      born: '2026-01-15T09:30:00Z',
      status: 'available'
    })
  })

  it('substitutes documented path parameters into the request URL', () => {
    const op = baseOp({
      match: { urlPattern: '/pet/{petId}', method: 'GET' },
      parameters: [
        { name: 'petId', location: 'path', type: 'integer', required: true, example: 123 }
      ],
      responses: { '200': { examples: { 'application/json': {} } } }
    })
    const out = synthesizeOperationPreview(op, {}, { url: 'https://api.example.com/pet/{petId}' })
    expect(out?.request.url).toBe('https://api.example.com/pet/123')
    expect(out?.request.pathParams).toEqual({ petId: '123' })
  })

  it('returns null when the operation has no parameters AND no chaseable response', () => {
    const op = baseOp({ responses: { '200': {} } })
    expect(synthesizeOperationPreview(op, {})).toBeNull()
  })

  it('falls back to a model whose name matches the property name when the prop has no targetModelRef and `type: any`', () => {
    // Common Artifacts / Swagger pattern: a response wrapper carries
    // properties typed as `any` because the spec author skipped the
    // schema, even though a same-named model exists. The synthesiser
    // recovers the structure by name.
    const op = baseOp({ responses: { '200': { schema: 'CharacterFightDataSchema' } } })
    const models: Record<string, ModelDocumentation> = {
      CharacterFightDataSchema: {
        name: 'CharacterFightDataSchema',
        properties: [
          { name: 'cooldown', type: 'any', required: true },
          { name: 'character', type: 'any', required: true },
          { name: 'untyped', type: 'any', required: true }
        ]
      },
      Cooldown: {
        name: 'Cooldown',
        properties: [{ name: 'total_seconds', type: 'integer', required: true, example: 60 }]
      },
      // Stored under the `Schema` suffix — the synthesiser must try it.
      CharacterSchema: {
        name: 'CharacterSchema',
        properties: [{ name: 'name', type: 'string', required: true, example: 'Hero' }]
      }
    }
    const out = synthesizeOperationPreview(op, models)
    expect(out?.response.body).toEqual({
      cooldown: { total_seconds: 60 },
      character: { name: 'Hero' },
      untyped: null
    })
  })

  it('caps recursion on self-referential models so it returns a finite tree', () => {
    const op = baseOp({ responses: { '200': { schema: 'Comment' } } })
    const models: Record<string, ModelDocumentation> = {
      Comment: {
        name: 'Comment',
        properties: [
          { name: 'id', type: 'integer', required: true, example: 1 },
          { name: 'replies', type: 'array<Comment>', required: false, targetModelRef: 'Comment', isArrayOfRef: true }
        ]
      }
    }
    const out = synthesizeOperationPreview(op, models)
    // Walk the recursive `replies` chain; the helper must terminate.
    let cursor: unknown = out?.response.body
    let depth = 0
    while (cursor && typeof cursor === 'object' && 'replies' in cursor && Array.isArray((cursor as { replies: unknown[] }).replies)) {
      const next = (cursor as { replies: unknown[] }).replies[0]
      if (next === null || next === undefined) break
      cursor = next
      depth++
      if (depth > 20) throw new Error('recursion did not terminate')
    }
    // The exact depth doesn't matter, only that it terminated.
    expect(depth).toBeGreaterThan(0)
    expect(depth).toBeLessThanOrEqual(20)
  })
})
