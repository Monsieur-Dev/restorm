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

describe('resolveWithContextPriority — an UNDEFINED variable renders empty', () => {
  it('renders empty for a name that collides with a block helper and is absent from the context', () => {
    // `test` is a registered BLOCK helper. Dispatched as a no-arg inline call
    // it reads `options` off a parameter it never got and throws, which used
    // to make the caller return the whole raw template — so a single unknown
    // variable was sent over the wire with its braces intact.
    expect(r('a{{test}}b', {})).toBe('ab')
    expect(r('{{test}}', {})).toBe('')
  })

  it('leaves a colliding helper that SUCCEEDS with no args dispatching to the helper', () => {
    // The boundary of what's decidable: `{{min}}` with no numbers returns 0
    // rather than throwing, so nothing distinguishes "undefined variable" from
    // "deliberate no-arg helper call" and the helper keeps winning. Only a
    // helper that CANNOT be called with no args (it throws) falls through to
    // the variable reading. Defining the variable resolves the ambiguity —
    // that is what the context-priority pass above is for.
    expect(r('a{{min}}b', {})).toBe('a0b')
    expect(r('a{{min}}b', { min: 5 })).toBe('a5b')
  })

  it('does not poison the other mustaches in the same template', () => {
    expect(r('{{host}}/{{test}}/{{port}}', { host: 'localhost', port: '8080' })).toBe('localhost//8080')
  })

  it('still calls a legitimate no-arg helper rather than reading it as a variable', () => {
    // The retry pass must not fire here: `uuid` succeeds on the first compile,
    // so it keeps generating a value instead of silently rendering empty.
    expect(r('{{uuid}}', {})).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)
  })

  it('keeps block usage of a colliding helper working', () => {
    expect(r('{{#test "abc" "b"}}yes{{else}}no{{/test}}', {})).toBe('yes')
    expect(r('{{#test "abc" "z"}}yes{{else}}no{{/test}}', {})).toBe('no')
  })
})
