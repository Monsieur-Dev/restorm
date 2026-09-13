import { describe, it, expect } from 'vitest'
import { prettyPrintedPaste } from './importPaste'

describe('prettyPrintedPaste', () => {
  it('pretty-prints a one-line JSON document pasted into an empty field', () => {
    expect(prettyPrintedPaste('', '{"openapi":"3.0.0","paths":{"/pets":{}}}')).toBe(
      '{\n  "openapi": "3.0.0",\n  "paths": {\n    "/pets": {}\n  }\n}'
    )
    expect(prettyPrintedPaste('  ', ' [1,2] ')).toBe('[\n  1,\n  2\n]')
  })

  it('leaves everything else to the normal paste', () => {
    expect(prettyPrintedPaste('already typed', '{"a":1}')).toBeNull()
    expect(prettyPrintedPaste('', 'https://api.test/openapi.json')).toBeNull()
    expect(prettyPrintedPaste('', 'openapi: 3.0.0\npaths: {}')).toBeNull()
    expect(prettyPrintedPaste('', '{"broken":')).toBeNull()
    expect(prettyPrintedPaste('', '"just a string"')).toBeNull()
    // Already pretty: nothing to do.
    expect(prettyPrintedPaste('', '{\n  "a": 1\n}')).toBeNull()
  })
})
