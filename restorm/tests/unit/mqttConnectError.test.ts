import { describe, it, expect } from 'vitest'
import { describeMqttConnectError } from '../../src/main/services/WebSocketExecutionService'

/**
 * mqtt.js surfaces a bare socket error on a failed connect whose `.message` is
 * frequently empty (the failure lives in `.code`, e.g. `ECONNREFUSED`). Left
 * raw, that renders as just "error" in the Response panel. The mapper turns the
 * common Node socket codes into an actionable sentence that names the broker.
 */
describe('describeMqttConnectError', () => {
  const url = 'mqtt://localhost:1883'

  it('maps ECONNREFUSED to a "no broker listening" sentence naming the URL', () => {
    const msg = describeMqttConnectError({ code: 'ECONNREFUSED', message: '' }, url)
    expect(msg).toContain('refused')
    expect(msg).toContain(url)
  })

  it('maps ENOTFOUND to a host-resolution sentence', () => {
    expect(describeMqttConnectError({ code: 'ENOTFOUND' }, url)).toContain('Host not found')
  })

  it('maps ETIMEDOUT to a timeout sentence', () => {
    expect(describeMqttConnectError({ code: 'ETIMEDOUT' }, url)).toContain('timed out')
  })

  it('maps unreachable-network codes', () => {
    expect(describeMqttConnectError({ code: 'EHOSTUNREACH' }, url)).toContain('unreachable')
    expect(describeMqttConnectError({ code: 'ENETUNREACH' }, url)).toContain('unreachable')
  })

  it('prefers a non-empty message over a generic fallback', () => {
    expect(describeMqttConnectError({ message: 'Not authorized', code: undefined }, url)).toBe('Not authorized')
  })

  it('falls back to the code when there is no message and the code is unmapped', () => {
    const msg = describeMqttConnectError({ code: 'EPIPE', message: '' }, url)
    expect(msg).toContain('EPIPE')
    expect(msg).toContain(url)
  })

  it('never renders a bare "error" — always returns a non-empty sentence even with no detail', () => {
    const msg = describeMqttConnectError({}, url)
    expect(msg.trim().length).toBeGreaterThan(0)
    expect(msg).toContain(url)
  })

  it('omits the broker clause gracefully when the URL is empty', () => {
    expect(describeMqttConnectError({ code: 'ECONNREFUSED' }, '')).not.toContain(' at ')
  })
})
