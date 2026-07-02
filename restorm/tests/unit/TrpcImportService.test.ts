/**
 * Unit tests for `TrpcImportService` — the best-effort router-introspection
 * importer for the restorm-specific `<base>/.trpc/_schema` shape (the same
 * shape `tests/docker/trpc-server/server.js` serves).
 */

import { describe, it, expect } from 'vitest'
import { detectFormat } from '../../src/main/services/import/ImportManager'
import { importTrpcSchema } from '../../src/main/services/import/TrpcImportService'
import type { TrpcRequest } from '../../src/shared/models'

const SCHEMA = JSON.stringify({
  procedures: {
    'user.get': { kind: 'query', input: { id: 'number' }, output: { id: 'number', name: 'string' } },
    'post.create': { kind: 'mutation', input: { title: 'string' }, output: { id: 'number', title: 'string' } },
    'error.fail': { kind: 'mutation', input: {}, output: {} },
    // An unrecognised procedure shape (no `kind`) — a real server on an
    // adapter this importer doesn't understand. Must not crash detection.
    'weird.thing': { input: { x: 'string' } }
  }
})

describe('detectFormat — tRPC', () => {
  it('detects the restorm tRPC schema shape', () => {
    expect(detectFormat(SCHEMA)).toBe('trpc')
  })

  it('does NOT mis-detect an unrelated JSON document', () => {
    expect(detectFormat(JSON.stringify({ hello: 'world' }))).not.toBe('trpc')
  })

  it('does NOT mis-detect a Postman collection (disjoint root shape)', () => {
    const postman = JSON.stringify({ info: { name: 'x', schema: 'https://schema.postman.com/v2.1.0' }, item: [] })
    expect(detectFormat(postman)).not.toBe('trpc')
  })

  it('bails on a `procedures` object with no recognised-kind entries', () => {
    const unrecognised = JSON.stringify({ procedures: { 'weird.thing': { input: {} } } })
    expect(detectFormat(unrecognised)).not.toBe('trpc')
  })

  it('bails on malformed JSON rather than throwing', () => {
    expect(() => detectFormat('{not json')).not.toThrow()
    expect(detectFormat('{not json')).not.toBe('trpc')
  })
})

describe('importTrpcSchema', () => {
  it('derives the base server URL by stripping the well-known schema suffix', () => {
    const folder = importTrpcSchema(SCHEMA, { sourceUrl: 'http://localhost:8096/.trpc/_schema' })
    const items = folder.items as unknown as TrpcRequest[]
    for (const item of items) {
      expect(item.url).toBe('http://localhost:8096')
    }
  })

  it('falls back to a Handlebars placeholder base URL when no sourceUrl is given (pasted content)', () => {
    const folder = importTrpcSchema(SCHEMA)
    const items = folder.items as unknown as TrpcRequest[]
    expect(items[0]?.url).toBe('{{baseUrl}}')
  })

  it('creates one request per recognised procedure, skipping unrecognised-kind entries', () => {
    const folder = importTrpcSchema(SCHEMA, { sourceUrl: 'http://localhost:8096/.trpc/_schema' })
    const items = folder.items as unknown as TrpcRequest[]
    const names = items.map((i) => i.name).sort()
    expect(names).toEqual(['error.fail', 'post.create', 'user.get'])
  })

  it('carries the procedure path + call kind onto each generated request', () => {
    const folder = importTrpcSchema(SCHEMA, { sourceUrl: 'http://localhost:8096/.trpc/_schema' })
    const items = folder.items as unknown as TrpcRequest[]
    const userGet = items.find((i) => i.name === 'user.get')
    expect(userGet?.procedure).toBe('user.get')
    expect(userGet?.kind).toBe('query')
    const postCreate = items.find((i) => i.name === 'post.create')
    expect(postCreate?.kind).toBe('mutation')
  })

  it('synthesizes a best-effort example input from the declared input types', () => {
    const folder = importTrpcSchema(SCHEMA, { sourceUrl: 'http://localhost:8096/.trpc/_schema' })
    const items = folder.items as unknown as TrpcRequest[]
    const userGet = items.find((i) => i.name === 'user.get')
    expect(userGet?.input).toBe('{"id":0}')
  })

  it('leaves `input` empty for a no-input procedure', () => {
    const folder = importTrpcSchema(SCHEMA, { sourceUrl: 'http://localhost:8096/.trpc/_schema' })
    const items = folder.items as unknown as TrpcRequest[]
    const errorFail = items.find((i) => i.name === 'error.fail')
    expect(errorFail?.input).toBe('')
  })

  it('produces stable ids across repeated imports of the same schema (idempotent re-import)', () => {
    const a = importTrpcSchema(SCHEMA, { sourceUrl: 'http://localhost:8096/.trpc/_schema' })
    const b = importTrpcSchema(SCHEMA, { sourceUrl: 'http://localhost:8096/.trpc/_schema' })
    const idsA = (a.items as unknown as TrpcRequest[]).map((i) => i.id).sort()
    const idsB = (b.items as unknown as TrpcRequest[]).map((i) => i.id).sort()
    expect(idsA).toEqual(idsB)
  })
})
