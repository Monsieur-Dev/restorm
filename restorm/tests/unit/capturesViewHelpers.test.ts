import { describe, it, expect } from 'vitest'
import { captureRouteLabel, captureBadgeId, escapeForRegex, runRowId, isRunRowId } from '../../src/renderer/src/components/Recording/capturesViewHelpers'
import type { RecordedCallSummary } from '../../src/shared/types/recordingCapture'

const base: RecordedCallSummary = { id: 'c', sessionId: 's', runId: 'r', protocol: 'http', timestamp: 0, method: 'GET', url: 'http://h/api/pets?x=1', resourceType: 'fetch' }

describe('captures view helpers', () => {
  it('labels a call by its route, operation or gRPC method', () => {
    expect(captureRouteLabel(base)).toBe('/api/pets?x=1')
    expect(captureRouteLabel({ ...base, protocol: 'graphql', graphql: { operationType: 'query', operationName: 'Pets' } })).toBe('Pets')
    expect(captureRouteLabel({ ...base, protocol: 'graphql', graphql: { operationType: 'mutation', operationName: null } })).toBe('mutation')
    expect(captureRouteLabel({ ...base, protocol: 'grpc-web', grpc: { service: 'S', method: 'M' } })).toBe('S/M')
    expect(captureRouteLabel({ ...base, url: 'not a url' })).toBe('not a url')
  })

  it('picks the protocol badge', () => {
    expect(captureBadgeId(base)).toBe('http_get')
    expect(captureBadgeId({ ...base, method: 'BREW' })).toBe('http_other')
    expect(captureBadgeId({ ...base, protocol: 'graphql' })).toBe('gql')
    expect(captureBadgeId({ ...base, protocol: 'grpc-web' })).toBe('grpc')
    expect(captureBadgeId({ ...base, protocol: 'websocket' })).toBe('ws')
  })

  it('escapes a url into an exact-match pattern', () => {
    expect(escapeForRegex('http://h/api/pets?x=1')).toBe('^http://h/api/pets\\?x=1$')
    expect(new RegExp(escapeForRegex('http://h/a.b')).test('http://h/a.b')).toBe(true)
    expect(new RegExp(escapeForRegex('http://h/a.b')).test('http://h/aXb')).toBe(false)
  })

  it('spells and recognises run rows', () => {
    expect(isRunRowId(runRowId('r1'))).toBe(true)
    expect(isRunRowId('c1')).toBe(false)
  })
})
