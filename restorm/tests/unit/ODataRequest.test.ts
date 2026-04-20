/**
 * Persistence round-trip tests for ODataRequest.
 *
 * Covers:
 * - The model class' `fromPlain` / `toPlainObject` symmetry (so files
 *   reloaded from disk come back with the same shape).
 * - Default values for optional fields — important because `operationKind`
 *   and `odataVersion` are reserved for Phase 3/4 but need stable defaults
 *   so older on-disk files don't crash the deserializer.
 */

import { describe, it, expect } from 'vitest'
import { ODataRequest } from '../../src/shared/models/requests/ODataRequest'
import { KeyValue } from '../../src/shared/models'

describe('ODataRequest — persistence round-trip', () => {
  it('defaults odataVersion to v4 and operationKind to entity-set when absent', () => {
    const req = ODataRequest.fromPlain({ name: 'People' })
    expect(req.odataVersion).toBe('v4')
    expect(req.operationKind).toBe('entity-set')
    expect(req.url).toBe('')
    expect(req.queryOptions).toEqual({})
    expect(req.headers).toEqual([])
    expect(req.params).toEqual([])
    expect(req.deprecated).toBe(false)
  })

  it('preserves queryOptions across fromPlain → toPlainObject', () => {
    const req = ODataRequest.fromPlain({
      name: 'People',
      url: 'https://x/People',
      queryOptions: { filter: "Age gt 21", select: ['Id', 'Name'], top: '25', skip: '0', count: true }
    })
    const plain = req.toPlainObject()
    expect(plain.queryOptions).toEqual({
      filter: "Age gt 21",
      select: ['Id', 'Name'],
      top: '25',
      skip: '0',
      count: true
    })
  })

  it('round-trips headers and params through KeyValue.fromPlain', () => {
    const req = ODataRequest.fromPlain({
      name: 'People',
      headers: [{ key: 'Accept', value: 'application/json' }],
      params: [{ key: 'api-version', value: '2024-01-01' }]
    })
    expect(req.headers).toHaveLength(1)
    expect(req.headers[0]).toBeInstanceOf(KeyValue)
    expect(req.headers[0]?.key).toBe('Accept')
    expect(req.params[0]?.key).toBe('api-version')
  })

  it('fromPlain(toPlainObject(req)) produces an equivalent instance', () => {
    const original = ODataRequest.fromPlain({
      name: 'People',
      url: '{{base}}/People',
      odataVersion: 'v4',
      operationKind: 'entity-set',
      headers: [{ key: 'Accept', value: 'application/json' }],
      queryOptions: { top: '10', count: true },
      tags: ['catalog']
    })
    const roundTripped = ODataRequest.fromPlain(
      original.toPlainObject() as unknown as Parameters<typeof ODataRequest.fromPlain>[0]
    )
    expect(roundTripped.name).toBe(original.name)
    expect(roundTripped.url).toBe(original.url)
    expect(roundTripped.odataVersion).toBe(original.odataVersion)
    expect(roundTripped.operationKind).toBe(original.operationKind)
    expect(roundTripped.queryOptions).toEqual(original.queryOptions)
    expect(roundTripped.tags).toEqual(original.tags)
  })

  it('carries type discriminator = "odata" on the plain object', () => {
    const plain = ODataRequest.fromPlain({ name: 'x' }).toPlainObject()
    expect(plain.type).toBe('odata')
  })
})
