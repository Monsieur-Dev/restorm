import { describe, it, expect, vi } from 'vitest'
import { collectionStore } from '../../services/CollectionStore'
import { contextService } from '../../services/ContextService'
import {
  transformExecutor,
  logExecutor,
  switchExecutor,
  nowExecutor,
  objectExecutor,
  setVariableExecutor,
  getVariableExecutor,
  assertExecutor,
  ifExecutor,
  mapExecutor,
  filterExecutor,
  addToListExecutor,
  removeFromListExecutor,
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

  it('does not HTML-escape the rendered value (matches the preview / map)', () => {
    const out = runTransform({ expression: { type: 'expression', value: '{{.}}' } }, { value: 'Tom & Jerry <go>' })
    expect(out.value).toEqual({ result: 'Tom & Jerry <go>' })
  })

  it('wraps the passed-through input under `result` when there is no expression', () => {
    const out = runTransform({}, { value: 42 })
    expect(out).toEqual({ port: 'out', value: { result: 42 } })
  })
})

function runLog(config: Record<string, unknown>, inputs: Record<string, unknown>, variables = new Map<string, unknown>()): { message: unknown; level: unknown; data: unknown } {
  const logged: { message: unknown; level: unknown; data: unknown }[] = []
  const act = { nodeId: 'l', kind: 'log', scope: [], inputs } as never
  const ctx = {
    node: { id: 'l', kind: 'log', config, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    variables,
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

  it('renders an EXPRESSION message with the `data` value as the Handlebars context', () => {
    // message now accepts any type; an Expression is rendered against `data`.
    const entry = runLog({ message: { type: 'expression', value: '{{name}} wins' } }, { data: { name: 'Bob' } })
    expect(entry.message).toBe('Bob wins')
  })

  it('logs a non-string message (number) as its string form', () => {
    const entry = runLog({ message: { type: 'numeric', value: 42 } }, {})
    expect(entry.message).toBe('42')
  })

  it('resolves a `variable` data operand to the live value (not the `{{cpt}}` template)', () => {
    // A variable in the log `data` must show the run value, not the raw
    // Handlebars template `concreteValue` renders for the static preview.
    const entry = runLog({ message: { type: 'string', value: 'cpt' }, data: { type: 'variable', value: 'cpt' } }, {}, new Map([['cpt', 7]]))
    expect(entry.data).toBe(7)
  })

  it('resolves a `variable` message operand to the live value', () => {
    const entry = runLog({ message: { type: 'variable', value: 'cpt' } }, {}, new Map([['cpt', 'Rouge']]))
    expect(entry.message).toBe('Rouge')
  })
})

describe('switchExecutor', () => {
  it('routes the trigger to the FIRST matching case (port id = the case id, no prefix)', () => {
    const cases = [{ id: 'a', value: { type: 'string', value: 'x' } }, { id: 'b', value: { type: 'string', value: 'y' } }]
    const out = runPure(switchExecutor, { cases }, { on: 'y' })
    expect(out.outputs).toEqual([{ port: 'b', value: 'y' }])
  })

  it('routes to `default` when no case matches', () => {
    const cases = [{ id: 'a', value: { type: 'string', value: 'x' } }]
    const out = runPure(switchExecutor, { cases }, { on: 'z' })
    expect(out.outputs).toEqual([{ port: 'default', value: 'z' }])
  })

  it('resolves the inline `on` value (not just a wired input) — numeric vs numeric case', () => {
    const cases = [{ id: 'one', value: { type: 'numeric', value: 1, format: 'decimal' } }, { id: 'two', value: { type: 'numeric', value: 2, format: 'decimal' } }]
    const out = runPure(switchExecutor, { on: { type: 'numeric', value: 2, format: 'decimal' }, cases }, {})
    expect(out.outputs).toEqual([{ port: 'two', value: 2 }])
  })

  it('matches a null `on` against a null case (null IS equal to null)', () => {
    const cases = [{ id: 'switch-default-case', value: { type: 'null' } }]
    const out = runPure(switchExecutor, { on: { type: 'null' }, cases }, {})
    expect(out.outputs).toEqual([{ port: 'switch-default-case', value: null }])
  })

  it('does NOT match a non-null `on` against a null case', () => {
    const cases = [{ id: 'nullcase', value: { type: 'null' } }]
    const out = runPure(switchExecutor, { on: { type: 'string', value: '' }, cases }, {})
    // The empty string is not null → falls through to `default`.
    expect(out.outputs).toEqual([{ port: 'default', value: '' }])
  })

  it('resolves a `variable` case value against the live run variables', () => {
    const cases = [{ id: 'v', value: { type: 'variable', value: 'null_var' } }]
    const out = runPure(switchExecutor, { on: { type: 'null' }, cases }, {}, new Map([['null_var', null]]))
    expect(out.outputs).toEqual([{ port: 'v', value: null }])
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
  it('assembles inline config properties keyed by property name', () => {
    const properties = [
      { id: 'p1', name: 'hello', value: { type: 'string', value: 'world' } },
      { id: 'p2', name: 'answer', value: { type: 'numeric', value: 42 } }
    ]
    const out = runPure(objectExecutor, { properties }, {})
    expect(out.outputs).toEqual([{ port: 'object', value: { hello: 'world', answer: 42 } }])
  })

  it('a wired property (keyed by its port id) overrides the inline value', () => {
    const properties = [{ id: 'p1', name: 'hello', value: { type: 'string', value: 'inline' } }]
    const out = runPure(objectExecutor, { properties }, { p1: 'wired' })
    expect(out.outputs).toEqual([{ port: 'object', value: { hello: 'wired' } }])
  })

  it('resolves a `variable` property against the run store', () => {
    const properties = [{ id: 'p1', name: 'cpt', value: { type: 'variable', value: 'counter' } }]
    const out = runPure(objectExecutor, { properties }, {}, new Map([['counter', 7]]))
    expect(out.outputs).toEqual([{ port: 'object', value: { cpt: 7 } }])
  })

  it('resolves an `environment` property to { name, variables } (resolved env vars)', () => {
    const envSpy = vi.spyOn(collectionStore, 'findEnvironmentById')
      .mockReturnValue({ id: 'env-uuid-123', name: 'localhost' } as never)
    const ctxSpy = vi.spyOn(contextService, 'getContext')
      .mockReturnValue({ baseUrl: 'http://localhost:5110', clientId: 'VALID' } as never)
    const properties = [{ id: 'p1', name: 'targetEnv', value: { type: 'environment', value: 'env-uuid-123' } }]
    const out = runPure(objectExecutor, { properties }, {})
    expect(out.outputs).toEqual([{
      port: 'object',
      value: { targetEnv: { name: 'localhost', variables: { baseUrl: 'http://localhost:5110', clientId: 'VALID' } } }
    }])
    expect(envSpy).toHaveBeenCalledWith('env-uuid-123')
    expect(ctxSpy).toHaveBeenCalledWith('env-uuid-123')
    envSpy.mockRestore(); ctxSpy.mockRestore()
  })

  it('omits the `variables` key for an environment with NO variables', () => {
    // An empty `variables: {}` rendered a misleading expandable-but-empty node
    // in the run log — drop the key entirely when the env has no variables.
    const envSpy = vi.spyOn(collectionStore, 'findEnvironmentById')
      .mockReturnValue({ id: 'env-empty', name: 'Sub-env' } as never)
    const ctxSpy = vi.spyOn(contextService, 'getContext').mockReturnValue({} as never)
    const properties = [{ id: 'p1', name: 'targetEnv', value: { type: 'environment', value: 'env-empty' } }]
    const out = runPure(objectExecutor, { properties }, {})
    expect(out.outputs).toEqual([{ port: 'object', value: { targetEnv: { name: 'Sub-env' } } }])
    envSpy.mockRestore(); ctxSpy.mockRestore()
  })
})

describe('setVariable / getVariable', () => {
  it('writes then reads the run variable store by name', () => {
    const vars = new Map<string, unknown>()
    const set = runPure(setVariableExecutor, { name: 'hp' }, { value: 42 }, vars)
    // Persists the value; emits no port (the old `event` signal was removed —
    // completion chains via the universal `Done` port).
    expect(set.outputs).toEqual([])
    expect(vars.get('hp')).toBe(42)

    const get = runPure(getVariableExecutor, { name: 'hp' }, {}, vars)
    expect(get.outputs).toEqual([{ port: 'value', value: 42 }])
  })

  it('getVariable reads the variable reference from `config.value` (the selector), not `config.name`', () => {
    // The node box stores the picked variable under `config.value` as a typed
    // `variable` value — reading `config.name` (which it never sets) emitted
    // `undefined`, so a downstream operand silently became 0.
    const vars = new Map<string, unknown>([['stringvariable', 'aaa']])
    const out = runPure(getVariableExecutor, { value: { type: 'variable', value: 'stringvariable' } }, {}, vars)
    expect(out.outputs).toEqual([{ port: 'value', value: 'aaa' }])
  })

  it('stores the INLINE config value when `value` is unwired (N = 5 typed inline)', () => {
    // The box has an inline typed-value field persisted under `config.value`.
    // Reading only the wired input stored `undefined` — so an inline `N = 5`
    // silently set the variable to nothing (downstream reads collapsed to 0).
    const vars = new Map<string, unknown>()
    runPure(setVariableExecutor, { name: 'N', value: { type: 'numeric', value: 5 } }, {}, vars)
    expect(vars.get('N')).toBe(5)
  })

  it('reads a `variable` inline value from the live store (copy one variable into another)', () => {
    const vars = new Map<string, unknown>([['src', 7]])
    runPure(setVariableExecutor, { name: 'dst', value: { type: 'variable', value: 'src' } }, {}, vars)
    expect(vars.get('dst')).toBe(7)
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

describe('ifExecutor', () => {
  it('compares objects structurally (deep) so two equal-but-distinct objects take `then`', () => {
    const left = { type: 'string', value: 'x' }
    const right = { type: 'string', value: 'x' }
    // wired operands are distinct object instances with identical contents
    const out = runPure(ifExecutor, { operator: '=' }, { left: { a: 1, b: { c: 2 } }, right: { a: 1, b: { c: 2 } } }, undefined, 'if')
    expect(out.outputs[0]?.port).toBe('then')
    void left; void right
  })

  it('routes to `else` when the deep contents differ', () => {
    const out = runPure(ifExecutor, { operator: '=' }, { left: { a: 1 }, right: { a: 2 } }, undefined, 'if')
    expect(out.outputs[0]?.port).toBe('else')
  })

  it('emits BOTH operands as { left, right } on the taken branch (no wired `in`)', () => {
    const out = runPure(ifExecutor, { operator: '=', left: { type: 'number', value: 5 }, right: { type: 'number', value: 5 } }, {}, undefined, 'if')
    expect(out.outputs).toEqual([{ port: 'then', value: { left: 5, right: 5 } }])
  })

  it('passes a wired `in` straight through to the taken branch', () => {
    const out = runPure(ifExecutor, { operator: '=', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } }, { in: 'payload' }, undefined, 'if')
    expect(out.outputs).toEqual([{ port: 'else', value: 'payload' }])
  })

  it('treats an UNSELECTED environment operand as null → `null = env(none)` takes `then`', () => {
    // No environment chosen (empty selection) resolves to null, so comparing it
    // to null is reflexive equality.
    const empty = runPure(ifExecutor, { operator: '=', left: { type: 'null' }, right: { type: 'environment', value: '' } }, {}, undefined, 'if')
    expect(empty.outputs[0]?.port).toBe('then')
  })

  it('treats an environment id that no longer resolves (shows "—") as null too', () => {
    // A stored env id that finds no environment renders as "—" in the UI — same
    // "no environment chosen" meaning → null → `then`.
    const envSpy = vi.spyOn(collectionStore, 'findEnvironmentById').mockReturnValue(undefined as never)
    const out = runPure(ifExecutor, { operator: '=', left: { type: 'null' }, right: { type: 'environment', value: 'stale-or-garbage-id' } }, {}, undefined, 'if')
    expect(out.outputs[0]?.port).toBe('then')
    envSpy.mockRestore()
  })
})

describe('addToList / removeFromList', () => {
  it('addToList appends each `values` row (one element apiece) to the wired target list', () => {
    const out = runPure(
      addToListExecutor,
      { values: [{ id: 'v1', value: { type: 'string', value: 'c' } }, { id: 'v2', value: { type: 'string', value: 'd' } }] },
      { list: ['a', 'b'] }
    )
    expect(out.outputs).toEqual([{ port: 'result', value: ['a', 'b', 'c', 'd'] }])
  })

  it('resolves an inline `list` literal as the target; a wired row wins over its inline value, and each row is ONE element', () => {
    const out = runPure(
      addToListExecutor,
      {
        list: { type: 'list', items: [{ type: 'string', value: 'x' }] },
        values: [
          { id: 'v1', value: { type: 'string', value: 'a' } },
          { id: 'v2', value: { type: 'string', value: 'IGNORED' } }
        ]
      },
      { v2: 'wired' } // a wired row arrives by its port id and wins over the inline value
    )
    expect(out.outputs).toEqual([{ port: 'result', value: ['x', 'a', 'wired'] }])
  })

  it('a row that resolves to a LIST is concatenated (spread), not nested', () => {
    const out = runPure(
      addToListExecutor,
      { values: [{ id: 'v1', value: { type: 'variable', value: 'extra' } }] },
      { list: ['x'] },
      new Map([['extra', ['y', 'z']]])
    )
    expect(out.outputs).toEqual([{ port: 'result', value: ['x', 'y', 'z'] }])
  })

  it('removeFromList drops every element deep-equal to any row value', () => {
    const out = runPure(
      removeFromListExecutor,
      { values: [{ id: 'v1', value: { type: 'string', value: 'a' } }] },
      { list: ['a', 'b', 'a', 'c'] }
    )
    expect(out.outputs).toEqual([{ port: 'result', value: ['b', 'c'] }])
  })

  it('removeFromList matches objects by deep equality (wired row carries the object)', () => {
    const out = runPure(
      removeFromListExecutor,
      { values: [{ id: 'v1', value: { type: 'string', value: '' } }] },
      { list: [{ id: 1 }, { id: 2 }], v1: { id: 1 } }
    )
    expect(out.outputs).toEqual([{ port: 'result', value: [{ id: 2 }] }])
  })

  it('honours a source wired into the DEFAULT (unpersisted) row when config.values is empty', () => {
    // A box with a single, never-persisted value row: the wire lands on the
    // default id and `config.values` stays absent. The lone wired value must
    // still count — else removeFromList drops nothing.
    const out = runPure(
      removeFromListExecutor,
      {},
      { list: [{ sku: 'p1', price: 10 }, { sku: 'p2', price: 15 }], 'list-mutation-default-value': { sku: 'p2', price: 15 } }
    )
    expect(out.outputs).toEqual([{ port: 'result', value: [{ sku: 'p1', price: 10 }] }])
  })

  it('addToList appends a source wired into the default row when config.values is empty', () => {
    const out = runPure(
      addToListExecutor,
      {},
      { list: ['a'], 'list-mutation-default-value': 'b' }
    )
    expect(out.outputs).toEqual([{ port: 'result', value: ['a', 'b'] }])
  })

  it('writes the result back into the source variable when updateSourceVariable is on', () => {
    const vars = new Map<string, unknown>([['basket', ['a']]])
    const out = runPure(
      addToListExecutor,
      { list: { type: 'variable', value: 'basket' }, updateSourceVariable: true, values: [{ id: 'v1', value: { type: 'string', value: 'b' } }] },
      {},
      vars
    )
    expect(out.outputs).toEqual([{ port: 'result', value: ['a', 'b'] }])
    expect(vars.get('basket')).toEqual(['a', 'b']) // pushed back into the variable
  })

  it('stays pure (no writeback) when updateSourceVariable is off', () => {
    const vars = new Map<string, unknown>([['basket', ['a']]])
    runPure(
      addToListExecutor,
      { list: { type: 'variable', value: 'basket' }, values: [{ id: 'v1', value: { type: 'string', value: 'b' } }] },
      {},
      vars
    )
    expect(vars.get('basket')).toEqual(['a']) // unchanged
  })

  it('does NOT write back when the list is WIRED (no source variable to push to)', () => {
    const vars = new Map<string, unknown>([['basket', ['a']]])
    runPure(
      addToListExecutor,
      { list: { type: 'variable', value: 'basket' }, updateSourceVariable: true, values: [] },
      { list: ['x'] },
      vars
    )
    expect(vars.get('basket')).toEqual(['a']) // the list came from the wire, not the variable
  })

  it('removeFromList also writes back when updateSourceVariable is on', () => {
    const vars = new Map<string, unknown>([['basket', ['a', 'b', 'a']]])
    runPure(
      removeFromListExecutor,
      { list: { type: 'variable', value: 'basket' }, updateSourceVariable: true, values: [{ id: 'v1', value: { type: 'string', value: 'a' } }] },
      {},
      vars
    )
    expect(vars.get('basket')).toEqual(['b'])
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

  it('throws when an operand is null (wired null, or an inline NullValue) instead of coercing to 0', () => {
    expect(() => runPure(arithmeticExecutor, { op: 'add' }, { a: null, b: 3 })).toThrow(/null/)
    expect(() => runPure(arithmeticExecutor, { op: 'add', a: { type: 'null' }, b: { type: 'numeric', value: 3, format: 'decimal' } }, {})).toThrow(/null/)
  })

  it('throws on a non-numeric operand instead of silently coercing to 0 (routes to error)', () => {
    // A getVariable of a string ("aaa") into an operand must surface an error,
    // not quietly compute 0 + 0.
    expect(() => runPure(arithmeticExecutor, { operator: '+' }, { a: 0, b: 'aaa' })).toThrow(/not a number/)
    expect(() => runPure(arithmeticExecutor, { operator: '+' }, { a: {}, b: 1 })).toThrow(/not a number/)
  })

  it('treats an unset / empty operand as 0 (the field placeholder), not an error', () => {
    // An unwired operand with no config shows "0" in the UI — keep that default
    // rather than erroring; only a REAL non-numeric value throws.
    expect(runPure(arithmeticExecutor, { operator: '+' }, { a: 5 }).outputs[0]?.value).toBe(5)
    expect(runPure(arithmeticExecutor, { operator: '+' }, { a: 5, b: '' }).outputs[0]?.value).toBe(5)
  })

  it('coerces string operands to numbers', () => {
    expect(runPure(arithmeticExecutor, { op: 'add' }, { a: '2', b: '5' }).outputs[0]?.value).toBe(7)
  })

  it('resolves inline typed-value config operands when a port is unwired', () => {
    // The node persists operands as `{ type:'numeric', value }`; an unwired
    // operand must read them (like comparator / if), not collapse to 0.
    const out = runPure(arithmeticExecutor, { op: 'add', a: { type: 'numeric', value: 4 }, b: { type: 'numeric', value: 1 } }, {})
    expect(out.outputs[0]?.value).toBe(5)
  })

  it('reads a `variable` config operand from the live run store (cpt = cpt + 1)', () => {
    const vars = new Map<string, unknown>([['cpt', 2]])
    const out = runPure(arithmeticExecutor, { op: 'add', a: { type: 'variable', value: 'cpt' }, b: { type: 'numeric', value: 1 } }, {}, vars)
    expect(out.outputs[0]?.value).toBe(3)
  })

  it('lets a wired port override the inline config operand', () => {
    const out = runPure(arithmeticExecutor, { op: 'add', a: { type: 'numeric', value: 99 }, b: { type: 'numeric', value: 1 } }, { a: 4 })
    expect(out.outputs[0]?.value).toBe(5)
  })

  it('honours the toggle SYMBOL operator persisted under `operator` (cpt − 1 subtracts, not adds)', () => {
    // The node box persists the operator as the toggle symbol (`+ − × ÷ %`) in
    // `config.operator` — NOT the canonical `op` name. Reading only `op` made
    // every operation fall through to the `add` default (so `cpt − 1` did
    // `cpt + 1`). Each symbol must map to its operation.
    expect(runPure(arithmeticExecutor, { operator: '−' }, { a: 5, b: 1 }).outputs[0]?.value).toBe(4)
    expect(runPure(arithmeticExecutor, { operator: '+' }, { a: 5, b: 1 }).outputs[0]?.value).toBe(6)
    expect(runPure(arithmeticExecutor, { operator: '×' }, { a: 5, b: 3 }).outputs[0]?.value).toBe(15)
    expect(runPure(arithmeticExecutor, { operator: '÷' }, { a: 6, b: 2 }).outputs[0]?.value).toBe(3)
    expect(runPure(arithmeticExecutor, { operator: '%' }, { a: 7, b: 3 }).outputs[0]?.value).toBe(1)
  })

  it('throws on a present-but-UNKNOWN operator (surfaces a corrupt node)', () => {
    expect(() => runPure(arithmeticExecutor, { operator: 'bogus' }, { a: 2, b: 3 })).toThrow(/unknown arithmetic operator/)
  })

  it('defaults a MISSING/empty operator to add (back-compat for legacy operator-less nodes)', () => {
    // Operator-less arithmetic nodes were persisted before the operator field
    // existed (missing == add was the historical default). They must keep
    // working on upgrade — only a present-but-unrecognised operator throws.
    expect(runPure(arithmeticExecutor, {}, { a: 2, b: 3 }).outputs[0]?.value).toBe(5)
    expect(runPure(arithmeticExecutor, { operator: '' }, { a: 2, b: 3 }).outputs[0]?.value).toBe(5)
  })
})

describe('booleanExecutor', () => {
  it('evaluates the configured boolean operator', () => {
    expect(runPure(booleanExecutor, { op: 'and' }, { a: true, b: false }).outputs[0]?.value).toBe(false)
    expect(runPure(booleanExecutor, { op: 'or' }, { a: true, b: false }).outputs[0]?.value).toBe(true)
    expect(runPure(booleanExecutor, { op: 'xor' }, { a: true, b: true }).outputs[0]?.value).toBe(false)
    expect(runPure(booleanExecutor, { op: 'not' }, { a: false }).outputs[0]?.value).toBe(true)
  })

  it('honours the toggle value persisted under `operator` (AND/OR/XOR), case-insensitively', () => {
    // The node box persists the toggle as `operator` with the uppercase label
    // (`AND`/`OR`/`XOR`) — reading only lowercase `op` made every boolean
    // default to AND.
    expect(runPure(booleanExecutor, { operator: 'OR' }, { a: true, b: false }).outputs[0]?.value).toBe(true)
    expect(runPure(booleanExecutor, { operator: 'XOR' }, { a: true, b: true }).outputs[0]?.value).toBe(false)
    expect(runPure(booleanExecutor, { operator: 'AND' }, { a: true, b: false }).outputs[0]?.value).toBe(false)
  })
})
