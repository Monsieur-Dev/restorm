import { describe, it, expect } from 'vitest'
import { applyYaml, isYamlOp, YAML_OPS } from './scenarioYaml'

describe('scenarioYaml — the one YAML core (runtime + preview)', () => {
  it('parse: a YAML string → its value', () => {
    expect(applyYaml('a: 1\nb:\n  - 2\n  - 3\n', 'parse')).toEqual({ a: 1, b: [2, 3] })
    expect(applyYaml('42', 'parse')).toBe(42)
    expect(applyYaml('hi', 'parse')).toBe('hi')
  })

  it('parse: an already-structured (non-string) value passes through (idempotent)', () => {
    const obj = { a: 1 }
    expect(applyYaml(obj, 'parse')).toBe(obj)
  })

  it('parse: malformed YAML THROWS (→ error port)', () => {
    expect(() => applyYaml('a: [1, 2', 'parse')).toThrow()
    expect(() => applyYaml('foo:\n\tbad-tab: 1', 'parse')).toThrow()
  })

  it('stringify: a value → a YAML string; round-trips parse', () => {
    const yaml = applyYaml({ a: 1, b: [2, 3] }, 'stringify')
    expect(yaml).toBe('a: 1\nb:\n  - 2\n  - 3\n')
    expect(applyYaml(yaml, 'parse')).toEqual({ a: 1, b: [2, 3] })
  })

  it('stringify: indent controls nesting width', () => {
    expect(applyYaml({ a: { b: 1 } }, 'stringify', 4)).toBe('a:\n    b: 1\n')
  })

  it('isYamlOp guards the union', () => {
    expect(YAML_OPS).toEqual(['parse', 'stringify'])
    expect(isYamlOp('stringify')).toBe(true)
    expect(isYamlOp('dump')).toBe(false)
  })
})
