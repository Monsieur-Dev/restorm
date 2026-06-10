import { describe, it, expect } from 'vitest'
import { jwtExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

function runJwt(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'j', kind: 'jwt', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = jwtExecutor({ nodeId: 'j', kind: 'jwt', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('jwtExecutor — wires the shared applyJwt onto `result`', () => {
  it('decodes a wired token', () => {
    expect(runJwt({}, { value: SAMPLE })).toEqual({
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
      signature: 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    })
  })

  it('reads a live variable operand', () => {
    const vars = new Map<string, unknown>([['token', SAMPLE]])
    const out = runJwt({ value: { type: 'variable', value: 'token' } }, {}, vars) as { payload: { name: string } }
    expect(out.payload.name).toBe('John Doe')
  })

  it('THROWS a malformed token so the scheduler routes it to `error`', () => {
    expect(() => runJwt({}, { value: 'notajwt' })).toThrow()
  })
})
