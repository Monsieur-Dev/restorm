// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { extractPortFromAuthority, parseAuthorityPort } from './WebSocketExecutionService'

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
    // Trailing non-digit residue (parseInt would have read 80) is rejected too.
    expect(extractPortFromAuthority('localhost:80abc', 3001)).toBe(3001)
  })
})

describe('parseAuthorityPort', () => {
  it('reads a valid port and marks it present', () => {
    expect(parseAuthorityPort('localhost:1883')).toEqual({ port: 1883, present: true })
    expect(parseAuthorityPort('example.com:8080')).toEqual({ port: 8080, present: true })
    expect(parseAuthorityPort('[::1]:3001')).toEqual({ port: 3001, present: true })
  })

  it('marks an absent port as not present (caller defaults)', () => {
    expect(parseAuthorityPort('localhost')).toEqual({ port: undefined, present: false })
    expect(parseAuthorityPort('[::1]')).toEqual({ port: undefined, present: false })
    // A bare IPv6 address has many colons and no port — not a present port.
    expect(parseAuthorityPort('2001:db8::1')).toEqual({ port: undefined, present: false })
    // An empty port segment (`host:`) is treated as absent, not invalid.
    expect(parseAuthorityPort('localhost:')).toEqual({ port: undefined, present: false })
  })

  it('marks a present-but-unparseable port so the caller can error', () => {
    // present:true + port:undefined is the typo signal the server bind rejects.
    expect(parseAuthorityPort('localhost:abc')).toEqual({ port: undefined, present: true })
    expect(parseAuthorityPort('localhost:0')).toEqual({ port: undefined, present: true })
    expect(parseAuthorityPort('localhost:80abc')).toEqual({ port: undefined, present: true })
    expect(parseAuthorityPort('[::1]:notaport')).toEqual({ port: undefined, present: true })
  })
})
