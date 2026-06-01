import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import {
  validateScenarioGraph,
  isValidSelectorPath,
  targetKey,
  type ValidationNode,
  type ScenarioNodeError,
  type ScenarioDataLink
} from './scenarioValidation'

// Identity-ish translator: return the default text so message assertions read
// naturally and `{{name}}`-style interpolation can be checked on substrings.
const t = ((_key: string, def: string, opts?: Record<string, unknown>) => {
  let out = def
  if (opts) for (const [k, v] of Object.entries(opts)) out = out.replace(`{{${k}}}`, String(v))
  return out
}) as unknown as TFunction

function node(id: string, kind: ValidationNode['kind'], config: Record<string, unknown> = {}): ValidationNode {
  return { id, kind, config }
}

function run(nodes: ValidationNode[], opts?: { dataLinks?: ScenarioDataLink[]; connected?: string[] }): Map<string, ScenarioNodeError[]> {
  return validateScenarioGraph(nodes, opts?.dataLinks ?? [], new Set(opts?.connected ?? []), t)
}

function codes(map: Map<string, { code: string }[]>, id: string): string[] {
  return (map.get(id) ?? []).map((e) => e.code)
}

describe('scenarioValidation — arithmetic division by zero', () => {
  it('flags ÷ with an absent operand b (defaults to numeric 0)', () => {
    const errs = run([node('a', 'arithmetic', { operator: '÷' })]).get('a') ?? []
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ code: 'division-by-zero', field: 'b' })
  })

  it('flags % with a literal-zero operand b', () => {
    expect(codes(run([node('a', 'arithmetic', { operator: '%', b: { type: 'numeric', value: 0 } })]), 'a')).toContain('division-by-zero')
  })

  it('does not flag when b is a non-zero literal', () => {
    expect(run([node('a', 'arithmetic', { operator: '÷', b: { type: 'numeric', value: 2 } })]).has('a')).toBe(false)
  })

  it('does not flag when b is wired (resolved at run time)', () => {
    expect(run([node('a', 'arithmetic', { operator: '÷' })], { connected: [targetKey('a', 'b')] }).has('a')).toBe(false)
  })

  it('does not flag for + / − / × operators', () => {
    expect(run([node('a', 'arithmetic', { operator: '+' })]).has('a')).toBe(false)
  })
})

describe('scenarioValidation — switch duplicate case values', () => {
  it('flags both cases sharing a value', () => {
    const map = run([node('s', 'switch', { cases: [
      { id: 'c1', value: { type: 'string', value: 'x' } },
      { id: 'c2', value: { type: 'string', value: 'x' } },
      { id: 'c3', value: { type: 'string', value: 'y' } }
    ] })])
    const fields = (map.get('s') ?? []).map((e) => e.field)
    expect(fields).toEqual(['c1', 'c2'])
  })

  it('does not flag distinct case values', () => {
    expect(run([node('s', 'switch', { cases: [
      { id: 'c1', value: { type: 'string', value: 'x' } },
      { id: 'c2', value: { type: 'string', value: 'y' } }
    ] })]).has('s')).toBe(false)
  })
})

describe('scenarioValidation — object properties', () => {
  it('flags an empty property name and a duplicate name', () => {
    const errs = run([node('o', 'object', { properties: [
      { id: 'p1', name: '' },
      { id: 'p2', name: 'k' },
      { id: 'p3', name: 'k' }
    ] })]).get('o') ?? []
    expect(errs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'object-prop-missing-name', field: 'p1' }),
      expect.objectContaining({ code: 'object-prop-duplicate', field: 'p2' }),
      expect.objectContaining({ code: 'object-prop-duplicate', field: 'p3' })
    ]))
  })

  it('accepts an object with no properties', () => {
    expect(run([node('o', 'object', { properties: [] })]).has('o')).toBe(false)
  })
})

describe('scenarioValidation — transform template', () => {
  it('flags an empty template body', () => {
    expect(codes(run([node('tr', 'transform')]), 'tr')).toContain('empty-template')
  })

  it('accepts a literal (no interpolation) template with no value input', () => {
    expect(run([node('tr', 'transform', { expression: { type: 'expression', value: 'Hello world' } })]).has('tr')).toBe(false)
  })

  it('flags a template that interpolates {{…}} when the value input is unwired', () => {
    expect(codes(run([node('tr', 'transform', { expression: { type: 'expression', value: '{{name}}' } })]), 'tr')).toContain('value-input-required')
  })
})

describe('scenarioValidation — names', () => {
  it('flags a nameless input and a duplicate input name', () => {
    const map = run([
      node('i1', 'input', { name: 'dup' }),
      node('i2', 'input', { name: 'dup' }),
      node('i3', 'input', { name: '' })
    ])
    expect(codes(map, 'i1')).toContain('duplicate-name')
    expect(codes(map, 'i2')).toContain('duplicate-name')
    expect(codes(map, 'i3')).toContain('missing-name')
  })

  it('requires an output value to be wired', () => {
    expect(codes(run([node('o', 'output', { name: 'out' })]), 'o')).toContain('value-required')
    expect(run([node('o', 'output', { name: 'out' })], { connected: [targetKey('o', 'value')] }).has('o')).toBe(false)
  })
})

describe('scenarioValidation — data-link selector', () => {
  it('flags an empty and a malformed selector on the consuming box', () => {
    const map = run([node('n', 'log')], { dataLinks: [
      { targetNodeId: 'n', targetPort: 'message', selector: '' },
      { targetNodeId: 'n', targetPort: 'data', selector: '1bad' }
    ] })
    const codesForN = (map.get('n') ?? []).map((e) => e.code)
    expect(codesForN).toEqual(expect.arrayContaining(['data-link-empty-path', 'data-link-bad-path']))
  })

  it('isValidSelectorPath accepts dotted / indexed / quoted paths and rejects bad roots', () => {
    expect(isValidSelectorPath('response.body.items[0].name')).toBe(true)
    expect(isValidSelectorPath("a['k'].b")).toBe(true)
    expect(isValidSelectorPath('1bad')).toBe(false)
    expect(isValidSelectorPath('a..b')).toBe(false)
  })

  it('isValidSelectorPath accepts a bracket-quoted root key (name with spaces)', () => {
    expect(isValidSelectorPath("['Anwser to the universe']")).toBe(true)
    expect(isValidSelectorPath('["full name"].first')).toBe(true)
    expect(isValidSelectorPath("['a b']['c d']")).toBe(true)
  })

  it('isValidSelectorPath accepts a `.<digit>` array segment (legacy generated paths)', () => {
    expect(isValidSelectorPath('response.body.0.id')).toBe(true)
  })

  it('isValidSelectorPath still rejects a stray bracket or empty segment', () => {
    expect(isValidSelectorPath("[]")).toBe(false)
    expect(isValidSelectorPath("['a'].")).toBe(false)
  })

  it('isValidSelectorPath accepts `.` (identity selector)', () => {
    expect(isValidSelectorPath('.')).toBe(true)
  })
})
