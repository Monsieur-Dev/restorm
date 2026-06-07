import { describe, it, expect } from 'vitest'
import { handlebarsReference, extractVariableName } from './handlebarsReference'

describe('handlebarsReference', () => {
  it('wraps a name containing whitespace in single quotes', () => {
    // A bare `{{a b}}` parses as a helper call and never resolves the value.
    expect(handlebarsReference('Answer to the universe')).toBe("{{'Answer to the universe'}}")
  })

  it('leaves a simple identifier bare', () => {
    expect(handlebarsReference('counter')).toBe('{{counter}}')
  })

  it('quotes a dotted path only when it carries whitespace', () => {
    expect(handlebarsReference('user.firstName')).toBe('{{user.firstName}}')
    expect(handlebarsReference('full name')).toBe("{{'full name'}}")
  })
})

describe('extractVariableName', () => {
  it('reads a single-quoted multi-word name', () => {
    expect(extractVariableName("'Answer to the universe'")).toBe('Answer to the universe')
  })

  it('reads a double-quoted multi-word name', () => {
    expect(extractVariableName('"full name"')).toBe('full name')
  })

  it('reads a bare identifier', () => {
    expect(extractVariableName('counter')).toBe('counter')
  })

  it('takes the first token of a helper expression', () => {
    expect(extractVariableName('uppercase name')).toBe('uppercase')
  })
})
