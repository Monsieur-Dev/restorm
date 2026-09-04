import { describe, it, expect } from 'vitest'
import { resolveScopeVars, type TemplateVariableDecl } from '../../src/shared/design/templateVariables'

// A fake evaluator that returns the expression verbatim, so tests drive the
// cascade + coercion directly (the real one runs Handlebars).
const echo = (expression: string): string => expression

const decls: TemplateVariableDecl[] = [
  { name: 'cacheType', scope: 'project', type: 'enum', options: ['none', 'memory', 'redis'], default: 'none' },
  { name: 'useCache', scope: 'route', type: 'boolean', default: 'false' },
  { name: 'ttl', scope: 'route', type: 'number', default: '60' },
  { name: 'label', scope: 'model', type: 'string', default: 'entity' }
]

describe('resolveScopeVars — cascade', () => {
  it('picks per-entity override over global over manifest default', () => {
    const r = resolveScopeVars({
      decls, scope: 'route',
      global: { useCache: 'true', ttl: '30' },
      overrides: { useCache: 'false' },
      evalContext: {}, evaluate: echo
    })
    expect(r.values).toEqual({ useCache: false, ttl: 30 }) // override wins for useCache, global for ttl
    expect(r.errors).toEqual([])
  })

  it('treats an empty value as "inherit from the next level"', () => {
    const r = resolveScopeVars({
      decls, scope: 'route',
      global: { useCache: 'true' },
      overrides: { useCache: '   ' }, // blank → inherit global
      evalContext: {}, evaluate: echo
    })
    expect(r.values.useCache).toBe(true)
  })

  it('falls back to the manifest default when nothing is set', () => {
    const r = resolveScopeVars({ decls, scope: 'route', evalContext: {}, evaluate: echo })
    expect(r.values).toEqual({ useCache: false, ttl: 60 })
  })

  it('only resolves declarations of the requested scope', () => {
    const r = resolveScopeVars({ decls, scope: 'project', evalContext: {}, evaluate: echo })
    expect(Object.keys(r.values)).toEqual(['cacheType'])
  })
})

describe('resolveScopeVars — coercion', () => {
  it('coerces booleans from common spellings', () => {
    const bool: TemplateVariableDecl[] = [{ name: 'b', scope: 'project', type: 'boolean' }]
    expect(resolveScopeVars({ decls: bool, scope: 'project', global: { b: 'yes' }, evalContext: {}, evaluate: echo }).values.b).toBe(true)
    expect(resolveScopeVars({ decls: bool, scope: 'project', global: { b: '0' }, evalContext: {}, evaluate: echo }).values.b).toBe(false)
  })

  it('reports an error (and drops the value) on a non-numeric number', () => {
    const num: TemplateVariableDecl[] = [{ name: 'n', scope: 'project', type: 'number' }]
    const r = resolveScopeVars({ decls: num, scope: 'project', global: { n: 'abc' }, evalContext: {}, evaluate: echo })
    expect(r.values).toEqual({})
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]?.name).toBe('n')
    expect(r.errors[0]?.message).toMatch(/number/)
  })

  it('reports an error on an enum value outside the options', () => {
    const r = resolveScopeVars({ decls, scope: 'project', global: { cacheType: 'disk' }, evalContext: {}, evaluate: echo })
    expect(r.values).toEqual({})
    expect(r.errors[0]?.message).toMatch(/none, memory, redis/)
  })
})

describe('resolveScopeVars — evaluation', () => {
  it('passes the entity eval-context to the evaluator and coerces its output', () => {
    const decl: TemplateVariableDecl[] = [{ name: 'useCache', scope: 'route', type: 'boolean', default: 'IGNORED' }]
    // Evaluator that returns "true" only for GET routes.
    const evaluate = (_expr: string, ctx: Record<string, unknown>): string =>
      String((ctx.route as { method?: string }).method === 'GET')
    const get = resolveScopeVars({ decls: decl, scope: 'route', evalContext: { route: { method: 'GET' } }, evaluate })
    const post = resolveScopeVars({ decls: decl, scope: 'route', evalContext: { route: { method: 'POST' } }, evaluate })
    expect(get.values.useCache).toBe(true)
    expect(post.values.useCache).toBe(false)
  })

  it('captures an evaluator throw as an error, entity-labelled, without crashing', () => {
    const decl: TemplateVariableDecl[] = [{ name: 'x', scope: 'model', type: 'string', default: '{{boom}}' }]
    const evaluate = (): string => { throw new Error('bad expression') }
    const r = resolveScopeVars({ decls: decl, scope: 'model', evalContext: {}, entity: 'User', evaluate })
    expect(r.values).toEqual({})
    expect(r.errors[0]).toMatchObject({ scope: 'model', name: 'x', entity: 'User', message: 'bad expression' })
  })
})
