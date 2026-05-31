import { describe, it, expect } from 'vitest'
import {
  transformExecutor,
  logExecutor,
  switchExecutor,
  nowExecutor,
  objectExecutor,
  setVariableExecutor,
  getVariableExecutor,
  assertExecutor,
  mapExecutor,
  filterExecutor,
  arithmeticExecutor,
  booleanExecutor
} from './pureExecutors'
import type { ExecResult, NodeExecutor } from '../types'

/** Run a synchronous pure executor with a minimal activation + context. Pass a
 * real `kind` for executors that dispatch on it (map / filter via applyListOp). */
function runPure(
  executor: NodeExecutor,
  config: Record<string, unknown>,
  inputs: Record<string, unknown>,
  variables = new Map<string, unknown>(),
  kind = 'x'
): ExecResult {
  const act = { nodeId: 'n', kind, scope: [], inputs } as never
  const ctx = {
    node: { id: 'n', kind, config, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    variables,
    log: () => undefined
  } as never
  return executor(act, ctx) as ExecResult
}

/**
 * The transform ("Transform template") node compiles a Handlebars template.
 * Its expression is persisted as a typed value-object
 * (`{ type: 'expression', value }`), NOT a bare string — feeding the object
 * straight to Handlebars throws "You must pass a string or Handlebars
 * template". These cover the unwrap + the template context.
 */

function runTransform(
  config: Record<string, unknown>,
  inputs: Record<string, unknown>,
  variables = new Map<string, unknown>()
): { port: string; value: unknown } {
  const act = { nodeId: 't', kind: 'transform', scope: [], inputs } as never
  const ctx = {
    node: { id: 't', kind: 'transform', config, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    variables
  } as never
  const result = transformExecutor(act, ctx) as { outputs: { port: string; value: unknown }[] }
  return result.outputs[0] as { port: string; value: unknown }
}

describe('transformExecutor', () => {
  it('unwraps a value-object expression (no "must pass a string" crash)', () => {
    const out = runTransform(
      { expression: { type: 'expression', value: '{{name}} part en guerre' } },
      { value: { name: 'Glaude' } }
    )
    // Wrapped as `{ result }` to match the static-preview shape (so the
    // auto-deduced `result` selector resolves at runtime).
    expect(out).toEqual({ port: 'out', value: { result: 'Glaude part en guerre' } })
  })

  it('renders an object value\'s fields directly (value IS the context)', () => {
    const out = runTransform(
      { expression: { type: 'expression', value: 'hi {{name}}' } },
      { value: { name: 'Bob' } }
    )
    expect(out.value).toEqual({ result: 'hi Bob' })
  })

  it('renders `{{.}}` as the scalar value (e.g. after an edge selector), not "[object Object]"', () => {
    // Repro of the inspector-preview-vs-runtime bug: an Input emits `{name}`,
    // the edge selector picks `.name` → the value reaching the transform is the
    // scalar "Glaude"; `{{.}}` must render it, matching the preview.
    const out = runTransform(
      { expression: { type: 'expression', value: '{{.}} est bien reposé' } },
      { value: 'Glaude' }
    )
    expect(out.value).toEqual({ result: 'Glaude est bien reposé' })
  })

  it('accepts a bare-string expression, with the value as context', () => {
    const out = runTransform({ expression: 'x={{.}}' }, { value: 'y' })
    expect(out.value).toEqual({ result: 'x=y' })
  })

  it('wraps the passed-through input under `result` when there is no expression', () => {
    const out = runTransform({}, { value: 42 })
    expect(out).toEqual({ port: 'out', value: { result: 42 } })
  })
})

function runLog(config: Record<string, unknown>, inputs: Record<string, unknown>): { message: unknown; level: unknown; data: unknown } {
  const logged: { message: unknown; level: unknown; data: unknown }[] = []
  const act = { nodeId: 'l', kind: 'log', scope: [], inputs } as never
  const ctx = {
    node: { id: 'l', kind: 'log', config, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    variables: new Map<string, unknown>(),
    log: (e: { message: unknown; level: unknown; data: unknown }) => { logged.push(e) }
  } as never
  void logExecutor(act, ctx)
  return logged[0] as { message: unknown; level: unknown; data: unknown }
}

describe('logExecutor', () => {
  it('logs the WIRED message input (not just config)', () => {
    const entry = runLog({ level: 'warn' }, { message: 'Glaude part en guerre' })
    expect(entry.message).toBe('Glaude part en guerre')
    expect(entry.level).toBe('warn')
  })

  it('falls back to the configured message value-object when unwired', () => {
    const entry = runLog({ message: { type: 'string', value: 'hi' } }, {})
    expect(entry.message).toBe('hi')
  })
})

describe('switchExecutor', () => {
  it('routes to the matching case port', () => {
    const out = runPure(switchExecutor, { cases: [{ id: 'a', value: 'x' }, { id: 'b', value: 'y' }] }, { on: 'y' })
    expect(out.outputs).toEqual([{ port: 'case-b', value: 'y' }])
  })

  it('routes to `default` when no case matches', () => {
    const out = runPure(switchExecutor, { cases: [{ id: 'a', value: 'x' }] }, { on: 'z' })
    expect(out.outputs).toEqual([{ port: 'default', value: 'z' }])
  })
})

describe('nowExecutor', () => {
  it('emits an epoch number when configured', () => {
    const out = runPure(nowExecutor, { format: 'epoch' }, {})
    expect(typeof out.outputs[0]?.value).toBe('number')
  })

  it('emits an ISO datetime string by default', () => {
    const out = runPure(nowExecutor, {}, {})
    expect(out.outputs[0]?.port).toBe('value')
    expect(out.outputs[0]?.value).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  })
})

describe('objectExecutor', () => {
  it('assembles its inputs into one object on the `object` port', () => {
    const out = runPure(objectExecutor, {}, { name: 'Bob', level: 3 })
    expect(out.outputs).toEqual([{ port: 'object', value: { name: 'Bob', level: 3 } }])
  })
})

describe('setVariable / getVariable', () => {
  it('writes then reads the run variable store by name', () => {
    const vars = new Map<string, unknown>()
    const set = runPure(setVariableExecutor, { name: 'hp' }, { value: 42 }, vars)
    // The write emits a passthrough signal on `event` and persists the value.
    expect(set.outputs).toEqual([{ port: 'event', value: 42 }])
    expect(vars.get('hp')).toBe(42)

    const get = runPure(getVariableExecutor, { name: 'hp' }, {}, vars)
    expect(get.outputs).toEqual([{ port: 'value', value: 42 }])
  })
})

describe('assertExecutor', () => {
  it('routes the trigger to `then` when the assertion holds', () => {
    const out = runPure(assertExecutor, { operator: 'eq', a: { type: 'number', value: 2 }, b: { type: 'number', value: 2 } }, { in: 'sig' })
    expect(out.outputs).toEqual([{ port: 'then', value: 'sig' }])
  })

  it('routes to `else` when the assertion fails (wired operands win over config)', () => {
    const out = runPure(assertExecutor, { operator: 'eq', a: { type: 'number', value: 2 } }, { in: 'sig', a: 2, b: 3 })
    expect(out.outputs[0]?.port).toBe('else')
  })
})

describe('mapExecutor', () => {
  it('renders the per-item Handlebars expression (same as the preview)', () => {
    const out = runPure(mapExecutor, { expression: { type: 'expression', value: '{{n}}' } }, { items: [{ n: 1 }, { n: 2 }, { n: 3 }] }, new Map(), 'map')
    // Handlebars renders to strings (the preview shape).
    expect(out.outputs).toEqual([{ port: 'mapped', value: ['1', '2', '3'] }])
  })

  it('passes items through unchanged when no expression is set', () => {
    const out = runPure(mapExecutor, {}, { items: [1, 2] }, new Map(), 'map')
    expect(out.outputs[0]?.value).toEqual([1, 2])
  })

  it('falls back to the configured items when `items` is unwired', () => {
    const out = runPure(mapExecutor, { items: { type: 'enumList', value: [{ n: 5 }, { n: 6 }] } }, {}, new Map(), 'map')
    expect(out.outputs[0]?.value).toEqual([{ n: 5 }, { n: 6 }])
  })
})

describe('filterExecutor', () => {
  it('partitions items into kept (match) and rejected (non-match)', () => {
    const out = runPure(
      filterExecutor,
      { operator: '>', value: { type: 'numeric', value: 1 } },
      { items: [0, 2, 3] },
      new Map(),
      'filter'
    )
    expect(out.outputs).toEqual([
      { port: 'kept', value: [2, 3] },
      { port: 'rejected', value: [0] }
    ])
  })
})

describe('arithmeticExecutor', () => {
  it('applies the configured operator to a and b', () => {
    expect(runPure(arithmeticExecutor, { op: 'add' }, { a: 2, b: 3 }).outputs).toEqual([{ port: 'result', value: 5 }])
    expect(runPure(arithmeticExecutor, { op: 'mul' }, { a: 4, b: 3 }).outputs[0]?.value).toBe(12)
    expect(runPure(arithmeticExecutor, { op: 'sub' }, { a: 10, b: 4 }).outputs[0]?.value).toBe(6)
  })

  it('throws on division by zero (routes to the error path)', () => {
    expect(() => runPure(arithmeticExecutor, { op: 'div' }, { a: 1, b: 0 })).toThrow('division by zero')
  })

  it('coerces string operands to numbers', () => {
    expect(runPure(arithmeticExecutor, { op: 'add' }, { a: '2', b: '5' }).outputs[0]?.value).toBe(7)
  })
})

describe('booleanExecutor', () => {
  it('evaluates the configured boolean operator', () => {
    expect(runPure(booleanExecutor, { op: 'and' }, { a: true, b: false }).outputs[0]?.value).toBe(false)
    expect(runPure(booleanExecutor, { op: 'or' }, { a: true, b: false }).outputs[0]?.value).toBe(true)
    expect(runPure(booleanExecutor, { op: 'xor' }, { a: true, b: true }).outputs[0]?.value).toBe(false)
    expect(runPure(booleanExecutor, { op: 'not' }, { a: false }).outputs[0]?.value).toBe(true)
  })
})
