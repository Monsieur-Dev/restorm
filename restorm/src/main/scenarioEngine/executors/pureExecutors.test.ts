import { describe, it, expect } from 'vitest'
import { transformExecutor, logExecutor } from './pureExecutors'

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

  it('spreads an object input so a template can reference its fields directly', () => {
    const out = runTransform(
      { expression: { type: 'expression', value: 'hi {{name}}' } },
      { value: { name: 'Bob' } }
    )
    expect(out.value).toEqual({ result: 'hi Bob' })
  })

  it('still accepts a bare-string expression', () => {
    const out = runTransform({ expression: 'x={{value}}' }, { value: 'y' })
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
