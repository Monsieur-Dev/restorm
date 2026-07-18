import { describe, it, expect } from 'vitest'
import { requestBadgeType, requestBadgeMode, requestBadgeIcon, kafkaModeIcon, resolveBadgeId, requestBadgeId } from '../../../src/renderer/src/utils/badgeUtils'
import type { Request } from '../../../src/renderer/src/../../shared/types/requests'

/**
 * `requestBadgeType` picks the protocol badge; `requestBadgeMode` reports
 * whether restorm HOSTS the protocol (server) — the pair drives the uniform
 * "server variant" rendering of any protocol badge.
 */
describe('badgeUtils — protocol badge + client/server mode', () => {
  it('a Socket.IO client request → SIO badge, client mode', () => {
    const req = { type: 'websocket', protocol: 'socketio' } as unknown as Request
    expect(requestBadgeType(req)).toBe('SIO')
    expect(requestBadgeMode(req)).toBe('client')
  })

  it('a Socket.IO server request → SIO badge, server mode', () => {
    const req = { type: 'websocket', protocol: 'socketio', server: true } as unknown as Request
    expect(requestBadgeType(req)).toBe('SIO')
    expect(requestBadgeMode(req)).toBe('server')
  })

  it('a raw WebSocket request is always client mode (no server flag)', () => {
    const req = { type: 'websocket', protocol: 'websocket' } as unknown as Request
    expect(requestBadgeType(req)).toBe('WS')
    expect(requestBadgeMode(req)).toBe('client')
  })

  it('non-websocket requests are always client mode', () => {
    const grpc = { type: 'grpc', callType: 'unary' } as unknown as Request
    expect(requestBadgeMode(grpc)).toBe('client')
  })

  it('fixed-badge protocols keep their registry label (the sidebar shows the same as the tab)', () => {
    expect(requestBadgeType({ type: 'sse' } as unknown as Request)).toBe('SSE')
    expect(requestBadgeType({ type: 'stomp' } as unknown as Request)).toBe('STOMP')
    expect(requestBadgeType({ type: 'redis' } as unknown as Request)).toBe('REDIS')
    expect(requestBadgeType({ type: 'jsonrpc' } as unknown as Request)).toBe('RPC')
    expect(requestBadgeType({ type: 'jsonrpcBatch' } as unknown as Request)).toBe('RPC[]')
    expect(requestBadgeType({ type: 'trpc' } as unknown as Request)).toBe('tRPC')
    expect(requestBadgeType({ type: 'kafka' } as unknown as Request)).toBe('KAFKA')
  })
})

/**
 * `requestBadgeIcon` adds a sub-type glyph only where a protocol's single badge
 * label can't tell its variants apart — today only Kafka (produce/consume/
 * browse share the `KAFKA` label). The glyph is the same one the Add menu shows.
 */
describe('badgeUtils — Kafka mode sub-type glyph', () => {
  it('maps each Kafka mode to its codicon', () => {
    expect(kafkaModeIcon('produce')).toBe('arrow-up')
    expect(kafkaModeIcon('consume')).toBe('plug')
    expect(kafkaModeIcon('browse')).toBe('eye')
    expect(kafkaModeIcon(undefined)).toBe('arrow-up')
  })

  it('requestBadgeIcon returns the Kafka mode glyph for kafka requests', () => {
    expect(requestBadgeIcon({ type: 'kafka', mode: 'consume' } as unknown as Request)).toBe('plug')
    expect(requestBadgeIcon({ type: 'kafka', mode: 'produce' } as unknown as Request)).toBe('arrow-up')
  })

  it('requestBadgeIcon returns undefined for protocols whose label already discriminates', () => {
    expect(requestBadgeIcon({ type: 'sse' } as unknown as Request)).toBeUndefined()
    expect(requestBadgeIcon({ type: 'grpc', callType: 'unary' } as unknown as Request)).toBeUndefined()
    expect(requestBadgeIcon({ type: 'http', method: 'GET' } as unknown as Request)).toBeUndefined()
  })
})

/**
 * `resolveBadgeId` maps the legacy `(type, mode, icon)` triple onto a
 * `badgeRegistry.json` id — the one mapping the Badge adapter and every
 * direct-id surface share. `requestBadgeId` is its saved-request shortcut.
 */
describe('badgeUtils — registry id resolution', () => {
  it('a plain type resolves to its base id', () => {
    expect(resolveBadgeId('GET', undefined, undefined)).toEqual({ badgeId: 'http_get' })
    expect(resolveBadgeId('WS', undefined, undefined)).toEqual({ badgeId: 'ws' })
    expect(resolveBadgeId('S-STR', undefined, undefined)).toEqual({ badgeId: 'grpc_sstr' })
    expect(resolveBadgeId('tRPC', undefined, undefined)).toEqual({ badgeId: 'trpc' })
  })

  it('an action codicon resolves to the per-protocol action id', () => {
    expect(resolveBadgeId('WS', undefined, 'arrow-up')).toEqual({ badgeId: 'ws_send' })
    expect(resolveBadgeId('WS', undefined, 'plug')).toEqual({ badgeId: 'ws_connect' })
    expect(resolveBadgeId('SIO', undefined, 'debug-disconnect')).toEqual({ badgeId: 'sio_close' })
  })

  it('Kafka and GraphQL glyphs use their overriding ids', () => {
    expect(resolveBadgeId('KAFKA', undefined, 'plug')).toEqual({ badgeId: 'kafka_consume' })
    expect(resolveBadgeId('KAFKA', undefined, 'arrow-up')).toEqual({ badgeId: 'kafka_produce' })
    expect(resolveBadgeId('KAFKA', undefined, 'eye')).toEqual({ badgeId: 'kafka_browse' })
    expect(resolveBadgeId('QUERY', undefined, 'broadcast')).toEqual({ badgeId: 'gql_subscribe' })
    expect(resolveBadgeId('QUERY', undefined, 'debug-disconnect')).toEqual({ badgeId: 'gql_unsubscribe' })
  })

  it('server mode resolves to the capsule id — fixed protocols vs the method-colored HTTP server', () => {
    expect(resolveBadgeId('WS', 'server', undefined)).toEqual({ badgeId: 'ws_server' })
    expect(resolveBadgeId('SOAP', 'server', undefined)).toEqual({ badgeId: 'soap_server' })
    // GraphQL keeps two labels today: workbench GQL vs scenario QUERY.
    expect(resolveBadgeId('GQL', 'server', undefined)).toEqual({ badgeId: 'gql_server' })
    expect(resolveBadgeId('QUERY', 'server', undefined)).toEqual({ badgeId: 'gql_query_server' })
    // HTTP mock server has no fixed entry — the method id + the server prop.
    expect(resolveBadgeId('GET', 'server', undefined)).toEqual({ badgeId: 'http_get', server: true })
  })

  it('an unknown type falls back to http_other', () => {
    expect(resolveBadgeId('FROB' as never, undefined, undefined)).toEqual({ badgeId: 'http_other' })
  })

  it('requestBadgeId composes type + mode + icon for a saved request', () => {
    expect(requestBadgeId({ type: 'websocket', protocol: 'socketio', server: true } as unknown as Request)).toBe('sio_server')
    expect(requestBadgeId({ type: 'kafka', mode: 'consume' } as unknown as Request)).toBe('kafka_consume')
    expect(requestBadgeId({ type: 'sse' } as unknown as Request)).toBe('sse')
    expect(requestBadgeId({ type: 'trpc' } as unknown as Request)).toBe('trpc')
    expect(requestBadgeId({ type: 'jsonrpc' } as unknown as Request)).toBe('rpc')
  })
})
