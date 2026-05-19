import { describe, it, expect } from 'vitest'
import { renderRecord } from './formatters'
import type { ConsoleRecord } from './types'

function record(overrides: Partial<ConsoleRecord> = {}): ConsoleRecord {
  return {
    id: 'rec-1',
    timestamp: '2026-05-10T00:00:00.000Z',
    protocol: 'http',
    method: 'GET',
    url: 'http://api.example.com/users',
    host: 'api.example.com',
    port: 80,
    headers: {},
    verdict: 'allow',
    ...overrides
  }
}

describe('console formatters — curl', () => {
  it('http: GET with no headers / no body', () => {
    expect(renderRecord(record(), 'curl')).toBe(
      "curl -X GET 'http://api.example.com/users'"
    )
  })

  it('http: POST with headers + JSON body, body pretty-printed', () => {
    const out = renderRecord(record({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: '{"name":"Alice","age":30}'
    }), 'curl')
    expect(out).toContain("curl -X POST 'http://api.example.com/users'")
    expect(out).toContain("-H 'content-type: application/json'")
    expect(out).toContain("-H 'authorization: Bearer x'")
    expect(out).toContain('--data-raw')
    // Pretty-printed: contains a real newline + 2-space indent.
    expect(out).toContain('"name": "Alice"')
  })

  it('graphql: produces an HTTP-shaped curl (same family)', () => {
    const out = renderRecord(record({ protocol: 'graphql', method: 'POST', url: 'http://x/graphql' }), 'curl')
    expect(out).toMatch(/^curl -X POST/)
  })

  it('grpc: emits grpcurl with -plaintext flag', () => {
    const out = renderRecord(record({
      protocol: 'grpc',
      method: 'pet.PetStore/GetPet',
      url: 'http://api.example.com/pet.PetStore/GetPet',
      body: '{"id":1}'
    }), 'curl')
    expect(out).toContain('grpcurl')
    expect(out).toContain('-plaintext')
    expect(out).toContain("'api.example.com:80'")
    expect(out).toContain("'pet.PetStore/GetPet'")
    expect(out).toContain("-d '{\"id\":1}'")
  })

  it('websocket: emits wscat -c with the URL', () => {
    const out = renderRecord(record({ protocol: 'websocket', url: 'ws://x/socket', headers: { Origin: 'https://app' } }), 'curl')
    expect(out).toContain("wscat -c 'ws://x/socket'")
    expect(out).toContain("-H 'Origin: https://app'")
  })
})

describe('console formatters — powershell', () => {
  it('http: Invoke-RestMethod with -Method + -Uri', () => {
    const out = renderRecord(record(), 'powershell')
    expect(out).toContain('Invoke-RestMethod')
    expect(out).toContain('-Method GET')
    expect(out).toContain("-Uri 'http://api.example.com/users'")
  })

  it('http: builds a $headers hashtable + $body variable', () => {
    const out = renderRecord(record({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}'
    }), 'powershell')
    expect(out).toContain('$headers = @{')
    expect(out).toContain("'content-type' = 'application/json'")
    expect(out).toContain('$body = ')
    expect(out).toContain('-Headers $headers')
    expect(out).toContain('-Body $body')
  })

  it('grpc: falls back to the unix tool with a comment header', () => {
    const out = renderRecord(record({
      protocol: 'grpc',
      method: 'pet.PetStore/GetPet',
      body: '{"id":1}'
    }), 'powershell')
    expect(out).toMatch(/^# No native PowerShell equivalent/m)
    expect(out).toContain('grpcurl')
  })

  it('websocket: falls back to wscat with a comment header', () => {
    const out = renderRecord(record({ protocol: 'websocket', url: 'ws://x/socket' }), 'powershell')
    expect(out).toMatch(/^# No native PowerShell equivalent/m)
    expect(out).toContain('wscat -c')
  })
})

describe('console formatters — exhaustive (protocol × shell) snapshot', () => {
  const protocols = ['http', 'https', 'graphql', 'soap', 'odata', 'grpc', 'websocket']

  for (const p of protocols) {
    it(`renders ${p} for both shells without throwing`, () => {
      const r = record({ protocol: p, method: p === 'grpc' ? 'pkg.Svc/Method' : 'POST', body: '{}' })
      expect(() => renderRecord(r, 'curl')).not.toThrow()
      expect(() => renderRecord(r, 'powershell')).not.toThrow()
      const curl = renderRecord(r, 'curl')
      const ps = renderRecord(r, 'powershell')
      expect(curl.length).toBeGreaterThan(0)
      expect(ps.length).toBeGreaterThan(0)
    })
  }
})
