/**
 * Persistence round-trip tests for AuthenticationRequest + the new
 * `authenticationRequestId` field on BaseRequest.
 */

import { describe, it, expect } from 'vitest'
import { AuthenticationRequest, HTTPRequest, ODataRequest, KeyValue } from '../../src/shared/models'

describe('AuthenticationRequest — persistence round-trip', () => {
  it('defaults method to POST, authErrorCodes to [401, 403], producedHeaders/[] etc.', () => {
    const req = AuthenticationRequest.fromPlain({ name: 'OAuth token' })
    expect(req.method).toBe('POST')
    expect(req.url).toBe('')
    expect(req.headers).toEqual([])
    expect(req.params).toEqual([])
    expect(req.producedHeaders).toEqual([])
    expect(req.authErrorCodes).toEqual([401, 403])
    expect(req.expirationExpression).toBeUndefined()
    expect(req.deprecated).toBe(false)
  })

  it('round-trips producedHeaders through KeyValue.fromPlain', () => {
    const req = AuthenticationRequest.fromPlain({
      name: 'token',
      producedHeaders: [
        { key: 'Authorization', value: 'Bearer {{access_token}}' },
        { key: 'X-Tenant', value: '{{tenant}}' }
      ]
    })
    expect(req.producedHeaders).toHaveLength(2)
    expect(req.producedHeaders[0]).toBeInstanceOf(KeyValue)
    expect(req.producedHeaders[0]?.key).toBe('Authorization')
    expect(req.producedHeaders[0]?.value.toString()).toBe('Bearer {{access_token}}')
  })

  it('preserves expirationExpression and authErrorCodes across fromPlain → toPlainObject', () => {
    const req = AuthenticationRequest.fromPlain({
      name: 'token',
      expirationExpression: '{{expires_in}}',
      authErrorCodes: [401, 403, 419]
    })
    const plain = req.toPlainObject()
    expect(plain.expirationExpression).toBe('{{expires_in}}')
    expect(plain.authErrorCodes).toEqual([401, 403, 419])
  })

  it('fromPlain(toPlainObject(req)) produces an equivalent instance', () => {
    const original = AuthenticationRequest.fromPlain({
      name: 'OAuth2 Client Credentials',
      url: '{{idp}}/token',
      method: 'POST',
      headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
      producedHeaders: [{ key: 'Authorization', value: '{{token_type}} {{access_token}}' }],
      expirationExpression: '{{expires_in}}',
      authErrorCodes: [401, 403],
      tags: ['auth']
    })
    const roundTripped = AuthenticationRequest.fromPlain(
      original.toPlainObject() as unknown as Parameters<typeof AuthenticationRequest.fromPlain>[0]
    )
    expect(roundTripped.name).toBe(original.name)
    expect(roundTripped.url).toBe(original.url)
    expect(roundTripped.method).toBe(original.method)
    expect(roundTripped.headers[0]?.key).toBe('Content-Type')
    expect(roundTripped.producedHeaders[0]?.key).toBe('Authorization')
    expect(roundTripped.expirationExpression).toBe(original.expirationExpression)
    expect(roundTripped.authErrorCodes).toEqual(original.authErrorCodes)
  })

  it('carries type discriminator = "auth" on the plain object', () => {
    const plain = AuthenticationRequest.fromPlain({ name: 'x' }).toPlainObject()
    expect(plain.type).toBe('auth')
  })

  it('omits expirationExpression from the plain object when absent', () => {
    const plain = AuthenticationRequest.fromPlain({ name: 'x' }).toPlainObject()
    expect('expirationExpression' in plain).toBe(false)
  })
})

describe('BaseRequest.authenticationRequestId round-trip', () => {
  it('HTTPRequest persists authenticationRequestId', () => {
    const req = HTTPRequest.fromPlain({
      name: 'Pets',
      method: 'GET',
      url: '/pets',
      authenticationRequestId: 'auth-abc-123'
    })
    expect(req.authenticationRequestId).toBe('auth-abc-123')
    const plain = req.toPlainObject()
    expect(plain.authenticationRequestId).toBe('auth-abc-123')
  })

  it('HTTPRequest omits authenticationRequestId from plain when absent', () => {
    const plain = HTTPRequest.fromPlain({ name: 'Pets', method: 'GET' }).toPlainObject()
    expect('authenticationRequestId' in plain).toBe(false)
  })

  it('ODataRequest persists authenticationRequestId', () => {
    const req = ODataRequest.fromPlain({
      name: 'List Pets',
      url: '{{base}}/Pets',
      authenticationRequestId: 'auth-odata-1'
    })
    expect(req.authenticationRequestId).toBe('auth-odata-1')
    const plain = req.toPlainObject()
    expect(plain.authenticationRequestId).toBe('auth-odata-1')
  })

  it('AuthenticationRequest itself supports authenticationRequestId (ignored per spec but still persisted)', () => {
    // Chained auth is out of scope; the field still round-trips so an
    // existing file isn't silently dropped during a reload.
    const req = AuthenticationRequest.fromPlain({
      name: 'chained token',
      authenticationRequestId: 'auth-parent'
    })
    expect(req.authenticationRequestId).toBe('auth-parent')
    expect(req.toPlainObject().authenticationRequestId).toBe('auth-parent')
  })
})
