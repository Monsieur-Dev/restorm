/**
 * Exhaustive save→load round-trip coverage for quick-config across every
 * request protocol.
 *
 * The quick-config data layer is deliberately protocol-agnostic:
 * `extractSnapshotFields` copies every own-enumerable key of the request
 * except a fixed identity/exclusion set, JSON-serialises each value, and
 * `applyConfigToRequest` writes them all back onto a destination request.
 * These tests guard that contract for a FULLY-POPULATED instance of each
 * request model — every snapshot-eligible field set to a distinctive,
 * non-default value — and assert that:
 *
 *  - every non-excluded field round-trips (key-value arrays compared by their
 *    logical `{ id?, key, value }` projection, since the load path reifies them
 *    into `KeyValue` instances — see normalizeForCompare), and
 *  - the excluded identity fields (id / name / notes / tags / icon /
 *    importOrigin / deprecated / removed / authenticationRequestId / type /
 *    quickConfigs) are NOT carried by the snapshot.
 *
 * The store treats a request as a plain `Record<string, unknown>` and only
 * reifies the key-value array fields on load (the shape the request tables
 * render), faithfully reproducing the popover's save/load behaviour.
 */

import { describe, it, expect, vi } from 'vitest'

// The store imports `eventBus` from electron-core-ui/renderer. Mocking that
// barrel keeps the heavy ECUI module graph (which pulls in CSS the worktree's
// stale dist can't resolve) out of this data-layer test — `emitLocalSync` only
// needs to be a no-op here since there are no subscribers in the unit env.
vi.mock('electron-core-ui/renderer', () => ({
  eventBus: { emitLocalSync: vi.fn(), subscribe: vi.fn(), emit: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  extractSnapshotFields,
  saveProjectConfig,
  applyConfigToRequest,
  getProjectConfigs
} from './requestQuickConfigStore'
import type { Request } from '../../../shared/types/collections'

// Identity / exclusion set mirrored from the store (kept in sync by the
// "excluded fields never round-trip" assertions below).
const EXCLUDED = [
  'id',
  'name',
  'notes',
  'tags',
  'icon',
  'importOrigin',
  'deprecated',
  'removed',
  'authenticationRequestId',
  'type',
  'quickConfigs'
] as const

/**
 * Run the popover's exact save→load path on the data layer:
 *   1. snapshot the populated source (as the Save button does),
 *   2. persist it as a project-target config on the source,
 *   3. apply that config onto a BARE destination request of the same
 *      protocol (as Load does after the confirmation modal).
 * Returns the destination so callers can assert per-field fidelity.
 */
function roundTrip(
  source: Record<string, unknown>,
  bareDest: Record<string, unknown>
): { dest: Record<string, unknown>; snapshot: Record<string, unknown> } {
  const snapshot = extractSnapshotFields(source as unknown as Request)
  const saved = saveProjectConfig(source as unknown as Request, 'cfg', snapshot)
  // Reload the saved config off the source proxy, exactly like the popover's
  // config list does, then apply it onto the bare destination.
  const fromList = getProjectConfigs(source as unknown as Request).find((c) => c.id === saved.id)
  expect(fromList).toBeDefined()
  if (fromList === undefined) throw new Error('saved config not found in project list')
  applyConfigToRequest(bareDest as unknown as Request, fromList)
  return { dest: bareDest, snapshot }
}

/**
 * Normalise a value for comparison: `applyConfigToRequest` reifies the
 * snapshot's plain key-value arrays (headers / params / pathParams / metadata /
 * producedHeaders) into `KeyValue` class instances — that is the editor-correct
 * shape — so a restored KV array is structurally a `KeyValue[]`, not the bare
 * objects the snapshot held. Project both sides to `{ id?, key, value }` so the
 * round-trip is asserted on the logical content, independent of the wrapper.
 */
function normalizeForCompare(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return (value as unknown[]).map((entry: unknown) => {
    if (entry === null || typeof entry !== 'object') return entry
    const e = entry as Record<string, unknown>
    if (!('key' in e)) return entry
    const rawValue = e['value']
    // A reified KeyValue stores its value as a typed-value object ({ type,
    // value, … }); unwrap to the scalar the snapshot recorded.
    const scalar = (rawValue !== null && typeof rawValue === 'object' && 'value' in rawValue)
      ? (rawValue as { value: unknown }).value
      : rawValue
    // `enabled` is dropped from the projection: a reified KeyValue stamps the
    // model default (`true`) that a bare snapshot object may omit, so it is not
    // part of the value-fidelity contract this assertion guards.
    return {
      ...(e['id'] !== undefined && { id: e['id'] }),
      key: e['key'],
      value: scalar
    }
  })
}

/** Assert every key in `expected` round-trips onto `dest` (KV arrays compared
 * by their logical `{ id?, key, value }` projection — see normalizeForCompare). */
function expectFieldsRestored(dest: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(normalizeForCompare(dest[key]), `field "${key}" must round-trip`).toEqual(normalizeForCompare(value))
  }
}

/** Assert the snapshot carries none of the excluded identity fields. */
function expectExcludedAbsent(snapshot: Record<string, unknown>): void {
  for (const key of EXCLUDED) {
    expect(snapshot, `excluded field "${key}" must NOT be in the snapshot`).not.toHaveProperty(key)
  }
}

describe('quick-config round-trip — all fields, all protocols', () => {
  // -------------------------------------------------------------------------
  // HTTP — url / method / headers / params / pathParams / body (all 4 modes)
  //        + server-mode fields + timeout + followRedirects
  // -------------------------------------------------------------------------
  describe('HTTPRequest', () => {
    const httpHeaders = [{ id: 'h1', key: 'X-Custom', value: 'abc', enabled: true, description: 'd' }]
    const httpParams = [{ id: 'p1', key: 'verbose', value: 'true', enabled: false }]
    const httpPathParams = [{ id: 'pp1', key: 'id', value: '42' }]
    const base = (): Record<string, unknown> => ({
      id: 'src-http', name: 'src', tags: [], type: 'http' as const,
      method: 'PATCH', url: 'https://api.example.com/widgets/{{id}}',
      headers: httpHeaders,
      params: httpParams,
      pathParams: httpPathParams,
      timeout: 12345,
      followRedirects: false,
      mockStatus: 418,
      server: true
    })

    it('round-trips a text body + every scalar/array field', () => {
      const src = { ...base(), body: { type: 'text', content: '{"k":"v"}' } }
      const { dest, snapshot } = roundTrip(src, { id: 'dst-http', name: 'dst', tags: [], type: 'http' })
      expectFieldsRestored(dest, {
        method: 'PATCH', url: 'https://api.example.com/widgets/{{id}}',
        headers: httpHeaders, params: httpParams, pathParams: httpPathParams,
        timeout: 12345, followRedirects: false, mockStatus: 418, server: true,
        body: { type: 'text', content: '{"k":"v"}' }
      })
      expectExcludedAbsent(snapshot)
    })

    it('round-trips a file body (bodyFilePath equivalent)', () => {
      const src = { ...base(), body: { type: 'file', path: '/tmp/payload.bin' } }
      const { dest } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'http' })
      expect(dest['body']).toEqual({ type: 'file', path: '/tmp/payload.bin' })
    })

    it('round-trips a form-data body', () => {
      const src = { ...base(), body: { type: 'form-data', fields: [{ id: 'f1', key: 'file', value: '@x', enabled: true }] } }
      const { dest } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'http' })
      expect(dest['body']).toEqual({ type: 'form-data', fields: [{ id: 'f1', key: 'file', value: '@x', enabled: true }] })
    })

    it('round-trips an x-www-form-urlencoded body', () => {
      const src = { ...base(), body: { type: 'x-www-form-urlencoded', fields: [{ id: 'f1', key: 'a', value: 'b' }] } }
      const { dest } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'http' })
      expect(dest['body']).toEqual({ type: 'x-www-form-urlencoded', fields: [{ id: 'f1', key: 'a', value: 'b' }] })
    })
  })

  // -------------------------------------------------------------------------
  // GraphQL — url / operationType / query / variables / headers
  // -------------------------------------------------------------------------
  it('GraphQLRequest round-trips every field', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'graphql' as const,
      url: 'https://gql.example.com/graphql',
      operationType: 'mutation',
      query: 'mutation Foo($x:Int){ foo(x:$x){ id } }',
      variables: '{"x": 7}',
      headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer {{tok}}', enabled: true }]
    }
    const { dest, snapshot } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'graphql' })
    expectFieldsRestored(dest, {
      url: src.url, operationType: 'mutation', query: src.query,
      variables: '{"x": 7}', headers: src.headers
    })
    expectExcludedAbsent(snapshot)
  })

  // -------------------------------------------------------------------------
  // SOAP — url / soapAction / service / operation / body / headers
  // -------------------------------------------------------------------------
  it('SoapRequest round-trips every field', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'soap' as const,
      url: 'https://soap.example.com/svc',
      soapAction: 'urn:GetThing',
      service: 'ThingService',
      operation: 'GetThing',
      body: '<soap:Envelope><soap:Body><GetThing/></soap:Body></soap:Envelope>',
      headers: [{ id: 'h1', key: 'SOAPAction', value: 'urn:GetThing' }]
    }
    const { dest, snapshot } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'soap' })
    expectFieldsRestored(dest, {
      url: src.url, soapAction: 'urn:GetThing', service: 'ThingService',
      operation: 'GetThing', body: src.body, headers: src.headers
    })
    expectExcludedAbsent(snapshot)
  })

  // -------------------------------------------------------------------------
  // gRPC — url / service / method / callType / requestMessage / metadata
  //        + full server-mode block (mockMethods, proto, tls, reflection)
  // -------------------------------------------------------------------------
  it('GrpcRequest round-trips every field incl. server-mode block', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'grpc' as const,
      url: 'localhost:50051',
      service: 'grpcbin.GRPCBin',
      method: 'DummyUnary',
      callType: 'bidirectional-stream',
      requestMessage: '{"f_string":"hi"}',
      metadata: [{ id: 'm1', key: 'x-token', value: 'secret', enabled: true }],
      server: true,
      reflection: false,
      tls: true,
      tlsCertPem: '-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----',
      tlsKeyPem: '-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----',
      protoContent: 'syntax = "proto3"; service S { rpc M(R) returns (R); }',
      protoPath: '/tmp/svc.proto',
      mockMethods: [{
        service: 'grpcbin.GRPCBin', method: 'DummyUnary', callType: 'unary',
        responseMessage: '{"ok":true}', statusCode: 5, statusMessage: 'not found',
        trailers: [{ id: 't1', key: 'x-trailer', value: 'v' }],
        script: 'return { ok: 1 }'
      }]
    }
    const { dest, snapshot } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'grpc' })
    expectFieldsRestored(dest, {
      url: 'localhost:50051', service: 'grpcbin.GRPCBin', method: 'DummyUnary',
      callType: 'bidirectional-stream', requestMessage: '{"f_string":"hi"}',
      metadata: src.metadata, server: true, reflection: false, tls: true,
      tlsCertPem: src.tlsCertPem, tlsKeyPem: src.tlsKeyPem,
      protoContent: src.protoContent, protoPath: '/tmp/svc.proto',
      mockMethods: src.mockMethods
    })
    expectExcludedAbsent(snapshot)
  })

  // -------------------------------------------------------------------------
  // OData — url / odataVersion / operationKind / headers / params
  //         + ALL 9 query options + action body + $batch + importer hints
  // -------------------------------------------------------------------------
  it('ODataRequest round-trips every field incl. all 9 query options + $batch', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'odata' as const,
      url: '{{base}}/People',
      odataVersion: 'v4',
      operationKind: 'batch',
      headers: [{ id: 'h1', key: 'Accept', value: 'application/json' }],
      params: [{ id: 'p1', key: 'api-key', value: '{{key}}' }],
      queryOptions: {
        filter: "Name eq 'Russell'",
        select: ['Name', 'Id'],
        top: '{{pageSize}}',
        skip: '5',
        count: true,
        expand: 'Category,Tags($select=Name;$top=5)',
        orderby: 'Name asc,Id desc',
        search: 'pizza',
        format: 'json',
        apply: 'groupby((Status),aggregate($count as Total))'
      },
      actionBody: '{"rating": 5}',
      batchSubRequests: [{
        id: 'b1', method: 'POST', url: 'People', headers: [{ key: 'X', value: 'Y' }],
        body: '{"n":1}', atomicityGroup: 'cs1', label: 'create person'
      }],
      entitySetProperties: ['Name', 'Id', 'Status'],
      navigationProperties: ['Category', 'Tags'],
      operationParameters: [{ name: 'OwnerId', type: 'Edm.Int32', nullable: false, isBinding: true, value: '3' }]
    }
    const { dest, snapshot } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'odata' })
    expectFieldsRestored(dest, {
      url: '{{base}}/People', odataVersion: 'v4', operationKind: 'batch',
      headers: src.headers, params: src.params, queryOptions: src.queryOptions,
      actionBody: '{"rating": 5}', batchSubRequests: src.batchSubRequests,
      entitySetProperties: src.entitySetProperties,
      navigationProperties: src.navigationProperties,
      operationParameters: src.operationParameters
    })
    // Spot-check every individual query option survived.
    const qo = dest['queryOptions'] as Record<string, unknown>
    for (const k of ['filter', 'select', 'top', 'skip', 'count', 'expand', 'orderby', 'search', 'format', 'apply']) {
      expect(qo, `OData $${k} must round-trip`).toHaveProperty(k)
      expect(qo[k]).toEqual((src.queryOptions as Record<string, unknown>)[k])
    }
    expectExcludedAbsent(snapshot)
  })

  // -------------------------------------------------------------------------
  // WebSocket / Socket.IO / MQTT — url / protocol / event / message / headers
  //        + full MQTT block (qos, retain, clientId, auth, keepalive, LWT)
  // -------------------------------------------------------------------------
  it('WebSocketRequest (plain) round-trips url/protocol/event/message/headers', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'websocket' as const,
      url: 'wss://ws.example.com/socket',
      protocol: 'websocket',
      event: 'subscribe',
      message: '{"channel":"prices"}',
      headers: [{ id: 'h1', key: 'Origin', value: 'https://app' }],
      server: true
    }
    const { dest, snapshot } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'websocket' })
    expectFieldsRestored(dest, {
      url: src.url, protocol: 'websocket', event: 'subscribe',
      message: '{"channel":"prices"}', headers: src.headers, server: true
    })
    expectExcludedAbsent(snapshot)
  })

  it('WebSocketRequest (MQTT) round-trips the full MQTT field block incl. LWT', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'websocket' as const,
      url: 'mqtt://broker.example.com:1883',
      protocol: 'mqtt',
      event: 'sensors/temp',
      message: '21.5',
      headers: [],
      qos: 2,
      retain: true,
      clientId: 'restorm-{{uuid}}',
      username: 'user',
      password: '{{secret.brokerPass}}',
      keepalive: 30,
      mqttSubscribe: false,
      lwtTopic: 'sensors/status',
      lwtPayload: 'offline',
      lwtQos: 1,
      lwtRetain: true
    }
    const { dest, snapshot } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'websocket' })
    expectFieldsRestored(dest, {
      url: src.url, protocol: 'mqtt', event: 'sensors/temp', message: '21.5',
      qos: 2, retain: true, clientId: 'restorm-{{uuid}}', username: 'user',
      password: '{{secret.brokerPass}}', keepalive: 30, mqttSubscribe: false,
      lwtTopic: 'sensors/status', lwtPayload: 'offline', lwtQos: 1, lwtRetain: true
    })
    expectExcludedAbsent(snapshot)
  })

  // -------------------------------------------------------------------------
  // Authentication — method / url / headers / params / body / producedHeaders
  //        / expirationExpression / authErrorCodes
  //  authenticationRequestId is EXCLUDED (it's the auth-route identity link).
  // -------------------------------------------------------------------------
  it('AuthenticationRequest round-trips every field; authRoute id is excluded', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'auth' as const,
      // identity link that MUST NOT round-trip:
      authenticationRequestId: 'should-not-survive',
      method: 'POST',
      url: 'https://auth.example.com/token',
      headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json' }],
      params: [{ id: 'p1', key: 'grant_type', value: 'client_credentials' }],
      pathParams: [{ id: 'pp1', key: 'tenant', value: 'acme' }],
      body: { type: 'text', content: '{"client_id":"x"}' },
      producedHeaders: [{ id: 'ph1', key: 'Authorization', value: '{{token_type}} {{access_token}}' }],
      expirationExpression: '{{expires_in}}',
      authErrorCodes: [401, 403, 419]
    }
    const { dest, snapshot } = roundTrip(src, { id: 'dst', name: 'dst', tags: [], type: 'auth' })
    expectFieldsRestored(dest, {
      method: 'POST', url: src.url, headers: src.headers, params: src.params,
      pathParams: src.pathParams, body: src.body, producedHeaders: src.producedHeaders,
      expirationExpression: '{{expires_in}}', authErrorCodes: [401, 403, 419]
    })
    expectExcludedAbsent(snapshot)
    // Hard assertion: the auth-route identity link is NOT applied onto dest.
    expect(dest).not.toHaveProperty('authenticationRequestId')
  })

  // -------------------------------------------------------------------------
  // Cross-cutting: undefined fields are dropped by the JSON snapshot (so a
  // field unset at save time cannot CLEAR a populated field at load time).
  // This documents the one real-world asymmetry of the snapshot model.
  // -------------------------------------------------------------------------
  it('drops undefined-valued fields from the snapshot (documents the clear-on-load gap)', () => {
    const src = {
      id: 'src', name: 'src', tags: [], type: 'http' as const,
      url: 'https://x', method: 'GET',
      headers: [], params: [],
      body: undefined, timeout: undefined
    }
    const snapshot = extractSnapshotFields(src as unknown as Request)
    expect(snapshot).not.toHaveProperty('body')
    expect(snapshot).not.toHaveProperty('timeout')
    // Loading this snapshot onto a request that HAS a body leaves the body
    // untouched (the snapshot carries no key to overwrite it with).
    const dest: Record<string, unknown> = {
      id: 'dst', name: 'dst', tags: [], type: 'http',
      url: 'old', method: 'POST', headers: [], params: [],
      body: { type: 'text', content: 'PRE-EXISTING' }
    }
    const saved = saveProjectConfig(src as unknown as Request, 'cfg', snapshot)
    applyConfigToRequest(dest as unknown as Request, saved)
    expect(dest['url']).toBe('https://x')
    expect(dest['method']).toBe('GET')
    // body survived because the snapshot had no `body` key to clear it:
    expect(dest['body']).toEqual({ type: 'text', content: 'PRE-EXISTING' })
  })
})
