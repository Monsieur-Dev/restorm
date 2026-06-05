import { describe, it, expect } from 'vitest'
import { cryptoExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

function runCrypto(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'c', kind: 'crypto', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = cryptoExecutor({ nodeId: 'c', kind: 'crypto', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('cryptoExecutor — wires the shared applyCrypto onto `result`', () => {
  it('hashes a wired value (sha256 default)', () => {
    expect(runCrypto({}, { value: 'abc' })).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('base64-encodes a wired value', () => {
    expect(runCrypto({ op: 'base64Encode' }, { value: 'hello' })).toBe('aGVsbG8=')
  })

  it('hmac uses the inline key', () => {
    expect(runCrypto({ op: 'hmacSha256', key: 'key' }, { value: 'The quick brown fox jumps over the lazy dog' })).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    )
  })

  it('uuid ignores the value and yields a v4', () => {
    expect(runCrypto({ op: 'uuid' })).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('reads a live variable operand', () => {
    const vars = new Map<string, unknown>([['secret', 'abc']])
    expect(runCrypto({ op: 'md5', value: { type: 'variable', value: 'secret' } }, {}, vars)).toBe(
      '900150983cd24fb0d6963f7d28e17f72'
    )
  })

  it('THROWS a keyless HMAC so the scheduler routes it to `error`', () => {
    expect(() => runCrypto({ op: 'hmacSha256' }, { value: 'x' })).toThrow()
  })
})
