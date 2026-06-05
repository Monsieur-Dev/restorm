import { describe, it, expect } from 'vitest'
import { applyJson, isJsonOp, JSON_OPS } from './scenarioJson'

describe('scenarioJson — the one JSON core (runtime + preview)', () => {
  it('parse: a JSON string → its value', () => {
    expect(applyJson('{"a":1,"b":[2,3]}', 'parse')).toEqual({ a: 1, b: [2, 3] })
    expect(applyJson('42', 'parse')).toBe(42)
    expect(applyJson('"hi"', 'parse')).toBe('hi')
    expect(applyJson('true', 'parse')).toBe(true)
    expect(applyJson('null', 'parse')).toBeNull()
  })

  it('parse: an already-structured (non-string) value passes through (idempotent)', () => {
    const obj = { a: 1 }
    expect(applyJson(obj, 'parse')).toBe(obj)
    expect(applyJson(7, 'parse')).toBe(7)
  })

  it('parse: malformed JSON THROWS (→ error port)', () => {
    expect(() => applyJson('{not json}', 'parse')).toThrow()
    expect(() => applyJson('', 'parse')).toThrow()
  })

  it('stringify: any value → a JSON string (compact by default)', () => {
    expect(applyJson({ a: 1, b: [2, 3] }, 'stringify')).toBe('{"a":1,"b":[2,3]}')
    expect(applyJson([1, 'x', true], 'stringify')).toBe('[1,"x",true]')
    expect(applyJson(42, 'stringify')).toBe('42')
    expect(applyJson('hi', 'stringify')).toBe('"hi"')
  })

  it('stringify: indent pretty-prints (capped at 10)', () => {
    expect(applyJson({ a: 1 }, 'stringify', 2)).toBe('{\n  "a": 1\n}')
  })

  it('stringify: a non-serialisable value THROWS', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => applyJson(circular, 'stringify')).toThrow()
    expect(() => applyJson(undefined, 'stringify')).toThrow(/Cannot JSON-stringify/)
  })

  it('isJsonOp guards the union', () => {
    expect(JSON_OPS).toEqual(['parse', 'stringify'])
    expect(isJsonOp('parse')).toBe(true)
    expect(isJsonOp('serialize')).toBe(false)
  })
})
