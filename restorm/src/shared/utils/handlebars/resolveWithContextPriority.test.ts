import { describe, it, expect, beforeAll } from 'vitest'
import { resolveWithContextPriority } from './resolveWithContextPriority'
import { registerHandlebarsHelpers } from './registerAll'

// The whole point of the resolver is to survive the real helper suite, which
// registers `min`, `max`, `test`, `trim`, `add`, … on the global Handlebars.
beforeAll(() => {
  registerHandlebarsHelpers()
})

const r = (tpl: string, ctx: Record<string, unknown>): string => resolveWithContextPriority(tpl, ctx)

describe('resolveWithContextPriority — context variables win over same-named helpers', () => {
  it('reads a variable whose name collides with an inline helper (min)', () => {
    // Without the fix `{{min}}` calls the helper with no numbers → "0".
    expect(r('{{min}}', { min: 5 })).toBe('5')
  })

  it('reads a variable whose name collides with a block helper (test)', () => {
    // Without the fix `{{test}}` invokes the regex block helper → throws.
    expect(r('{{test}}', { test: 'fake-slow-value' })).toBe('fake-slow-value')
  })

  it('still invokes the helper when arguments are present (≥1 arg ⇒ helper)', () => {
    // `{{min min}}` = call helper min on the variable min → Math.min(5) = 5.
    expect(r('{{min min}}', { min: 5 })).toBe('5')
    // `{{min min min}}` → Math.min(5, 5) = 5.
    expect(r('{{min min min}}', { min: 5 })).toBe('5')
  })

  it('leaves genuine helper calls with literal/other args untouched', () => {
    expect(r('{{min a b}}', { a: 9, b: 2, min: 5 })).toBe('2')
  })

  it('fixes a collision nested inside a block helper', () => {
    expect(r('{{#if host}}{{min}}{{/if}}', { host: 'localhost', min: 5 })).toBe('5')
  })

  it('does not rewrite subexpressions (explicit calls) — and does not throw', () => {
    // `(min)` is an explicit no-arg call; it must stay a helper invocation.
    expect(() => r('{{uppercase (min)}}', { min: 5 })).not.toThrow()
  })

  it('leaves a non-colliding variable exactly as before', () => {
    expect(r('{{host}}', { host: 'localhost' })).toBe('localhost')
    expect(r('{{scheme}}://{{host}}:{{port}}', { scheme: 'http', host: 'localhost', port: '8080' })).toBe(
      'http://localhost:8080'
    )
  })

  it('resolves an expression that references a colliding variable', () => {
    // The exact reported shape: a variable `test` + an expression `{{test}}`.
    const ctx = { test: 'fake-slow-value', test2: '{{test}}' }
    expect(r('{{test}}', ctx)).toBe('fake-slow-value')
    expect(r('{{test2}}', ctx)).toBe('{{test}}') // test2's literal value, not yet resolved
  })

  it('returns the raw template when there are no mustaches', () => {
    expect(r('plain string', { min: 5 })).toBe('plain string')
  })

  it('does not touch dotted / data / this paths', () => {
    expect(r('{{a.b}}', { a: { b: 'deep' }, min: 5 })).toBe('deep')
    expect(r('{{this.min}}', { min: 5 })).toBe('5')
  })

  it('keeps helpers working for non-colliding names alongside a colliding context', () => {
    // `add` helper still adds; `min` (colliding) reads the variable.
    expect(r('{{add a b}} / {{min}}', { a: 2, b: 3, min: 5 })).toBe('5 / 5')
  })
})
