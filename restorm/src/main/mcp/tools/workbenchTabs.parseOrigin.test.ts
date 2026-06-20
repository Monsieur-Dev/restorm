import { describe, it, expect, vi } from 'vitest'

// The module under test imports `electron` and `electron-core-ui` at the top
// level; stub both so importing the pure `parseOriginString` helper doesn't
// drag the real Electron / ECUI barrels into the node test environment.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('electron-core-ui', () => ({
  McpService: vi.fn(),
  permissionService: {}
}))

import { parseOriginString } from './workbenchTabs'

describe('parseOriginString', () => {
  it('parses a full origin with scheme + host + port', () => {
    expect(parseOriginString('https://api.example.com:8443')).toEqual({
      scheme: 'https',
      host: 'api.example.com',
      port: 8443
    })
  })

  it('defaults to 443 for https/wss and 80 otherwise when no port is given', () => {
    expect(parseOriginString('https://example.com')).toEqual({ scheme: 'https', host: 'example.com', port: 443 })
    expect(parseOriginString('http://example.com')).toEqual({ scheme: 'http', host: 'example.com', port: 80 })
    expect(parseOriginString('wss://example.com')).toEqual({ scheme: 'wss', host: 'example.com', port: 443 })
  })

  it('assumes https when the scheme is omitted', () => {
    expect(parseOriginString('example.com')).toEqual({ scheme: 'https', host: 'example.com', port: 443 })
  })

  it('lower-cases the scheme and host', () => {
    expect(parseOriginString('HTTPS://API.Example.COM:9000')).toEqual({
      scheme: 'https',
      host: 'api.example.com',
      port: 9000
    })
  })

  it('rejects port 0 — a rule keyed on it can never match a real connection', () => {
    expect(parseOriginString('http://example.com:0')).toBeNull()
  })

  it('rejects an out-of-range or non-numeric port', () => {
    expect(parseOriginString('http://example.com:70000')).toBeNull()
  })

  it('returns null for empty / unparseable input', () => {
    expect(parseOriginString('')).toBeNull()
    expect(parseOriginString('   ')).toBeNull()
    expect(parseOriginString('http://')).toBeNull()
  })
})
