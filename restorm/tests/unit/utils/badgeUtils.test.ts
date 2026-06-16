import { describe, it, expect } from 'vitest'
import { requestBadgeType, requestBadgeMode } from '../../../src/renderer/src/utils/badgeUtils'
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
})
