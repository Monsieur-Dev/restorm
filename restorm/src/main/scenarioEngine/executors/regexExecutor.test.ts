import { describe, it, expect } from 'vitest'
import { regexExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

/** Run the regex executor with a minimal activation + context. `wired` (when
 * present) feeds the `value` port; otherwise the inline `config.value` is used. */
function runRegex(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'r', kind: 'regex', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = regexExecutor({ nodeId: 'r', kind: 'regex', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('regexExecutor — wires the shared applyRegex onto `result`', () => {
  it('extracts the first capture group from a wired value', () => {
    expect(runRegex({ op: 'extract', pattern: '#(\\d+)' }, { value: 'order #42' })).toBe('42')
  })

  it('reads an inline string config value', () => {
    expect(runRegex({ op: 'test', pattern: '\\d', value: { type: 'string', value: 'abc1' } })).toBe(true)
  })

  it('replace honours an inline replacement (default op falls back to extract)', () => {
    expect(runRegex({ op: 'replace', pattern: '\\s+', replacement: '_' }, { value: 'a b  c' })).toBe('a_b_c')
  })

  it('reads a live variable operand', () => {
    const vars = new Map<string, unknown>([['body', 'token=ABC123']])
    expect(runRegex({ op: 'extract', pattern: 'token=(\\w+)', value: { type: 'variable', value: 'body' } }, {}, vars)).toBe('ABC123')
  })

  it('defaults to extract when op is missing/unknown', () => {
    expect(runRegex({ pattern: '\\w+' }, { value: 'hello world' })).toBe('hello')
  })

  it('THROWS an invalid pattern so the scheduler routes it to `error`', () => {
    expect(() => runRegex({ op: 'extract', pattern: '(unclosed' }, { value: 'x' })).toThrow()
  })
})
