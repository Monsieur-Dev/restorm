/**
 * Persistence round-trip tests for SoapRequest.
 *
 * Covers the model class' `fromPlain` / `toPlainObject` symmetry for the SOAP
 * mock-server fields — `server` + `mockOperations[]` — so a hosted SOAP mock
 * reloaded from disk comes back with the same shape (a documented persistence
 * trap). Client requests must stay clean on disk (no `server` / `mockOperations`
 * keys).
 */

import { describe, it, expect } from 'vitest'
import { SoapRequest } from '../../src/shared/models/requests/SoapRequest'

describe('SoapRequest model — server + mockOperations round-trip', () => {
  it('round-trips server mode + mockOperations through toPlainObject / fromPlain', () => {
    const original = new SoapRequest({
      name: 'Calculator mock',
      url: 'localhost:3003/calculator',
      server: true,
      mockOperations: [
        { name: 'Add', soapAction: 'urn:Add', responseBody: '<AddResult>7</AddResult>' },
        { name: 'Boom', responseBody: '<faultstring>kaput</faultstring>', isFault: true }
      ]
    })

    const plain = original.toPlainObject()
    expect(plain['server']).toBe(true)
    expect(plain['mockOperations']).toEqual([
      { name: 'Add', soapAction: 'urn:Add', responseBody: '<AddResult>7</AddResult>' },
      { name: 'Boom', responseBody: '<faultstring>kaput</faultstring>', isFault: true }
    ])

    const restored = SoapRequest.fromPlain(plain)
    expect(restored.server).toBe(true)
    expect(restored.url).toBe('localhost:3003/calculator')
    expect(restored.mockOperations).toEqual(original.mockOperations)
  })

  it('omits server + mockOperations when unset (client request stays clean on disk)', () => {
    const client = new SoapRequest({ name: 'Client', url: 'https://example.com/svc', soapAction: 'urn:Op' })
    const plain = client.toPlainObject()
    expect('server' in plain).toBe(false)
    expect('mockOperations' in plain).toBe(false)
  })

  it('does not alias the caller-supplied mockOperations array', () => {
    const ops = [{ name: 'Add', responseBody: '<r/>' }]
    const req = new SoapRequest({ server: true, mockOperations: ops })
    ops[0].responseBody = '<mutated/>'
    expect(req.mockOperations?.[0].responseBody).toBe('<r/>')
  })

  it('preserves mockOperations across a full serialize -> deserialize -> serialize cycle', () => {
    const req = new SoapRequest({
      name: 'Echo mock',
      server: true,
      url: 'localhost:3003/svc',
      mockOperations: [{ name: 'Echo', responseBody: '<EchoResult>hi</EchoResult>' }]
    })
    const first = req.toPlainObject()
    const second = SoapRequest.fromPlain(first).toPlainObject()
    expect(second).toEqual(first)
  })
})
