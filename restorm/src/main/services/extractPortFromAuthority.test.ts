// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { extractPortFromAuthority } from './WebSocketExecutionService'

describe('extractPortFromAuthority', () => {
  it('reads the port from a plain host:port', () => {
    expect(extractPortFromAuthority('localhost:1883', 1883)).toBe(1883)
    expect(extractPortFromAuthority('example.com:8080', 3001)).toBe(8080)
    expect(extractPortFromAuthority('127.0.0.1:5555', 1883)).toBe(5555)
  })

  it('reads the port from a bracketed IPv6 literal', () => {
    // A naive split(':')[1] returned the empty/address segment here.
    expect(extractPortFromAuthority('[::1]:1883', 1883)).toBe(1883)
    expect(extractPortFromAuthority('[2001:db8::1]:8080', 3001)).toBe(8080)
  })

  it('falls back to the default when no port is present', () => {
    expect(extractPortFromAuthority('localhost', 1883)).toBe(1883)
    expect(extractPortFromAuthority('[::1]', 1883)).toBe(1883)
    // A bare (unbracketed) IPv6 address has many colons and no port — must not
    // mis-read an address segment as a port.
    expect(extractPortFromAuthority('2001:db8::1', 3001)).toBe(3001)
  })

  it('falls back to the default on an invalid / non-positive port', () => {
    expect(extractPortFromAuthority('localhost:0', 1883)).toBe(1883)
    expect(extractPortFromAuthority('localhost:abc', 3001)).toBe(3001)
    expect(extractPortFromAuthority('[::1]:notaport', 1883)).toBe(1883)
  })
})
