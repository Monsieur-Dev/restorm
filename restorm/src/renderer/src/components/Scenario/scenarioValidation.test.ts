import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import {
  validateScenarioGraph,
  validateScenarioModel,
  isValidSelectorPath,
  targetKey,
  type ValidationNode,
  type ScenarioNodeError,
  type ScenarioDataLink
} from '../../../../shared/scenarioValidation'

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

  it('flags an object with NO properties (the empty default row must declare a name)', () => {
    // A fresh object shows one empty default property row — it must be flagged
    // just like a typed-then-cleared name, so the error appears immediately.
    expect(codes(run([node('o', 'object', { properties: [] })]), 'o')).toContain('object-prop-missing-name')
    expect(codes(run([node('o', 'object', {})]), 'o')).toContain('object-prop-missing-name')
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

  it('skips template checks when the expression input is wired (dynamic template)', () => {
    expect(run([node('tr', 'transform')], { connected: [targetKey('tr', 'expression')] }).has('tr')).toBe(false)
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

  it('exempts a predecessor-wired input from the inter-input duplicate rule', () => {
    // `i2` runs mid-flow (its `in` trigger is wired), so reusing the name a
    // top-level input declares is legitimate — only predecessor-less inputs
    // collide with each other.
    const map = run([
      node('i1', 'input', { name: 'dup' }),
      node('i2', 'input', { name: 'dup' })
    ], { connected: [targetKey('i2', 'in')] })
    expect(codes(map, 'i1')).not.toContain('duplicate-name')
    expect(map.has('i2')).toBe(false)
  })

  it('still flags duplicate names among two predecessor-less inputs even when a wired input shares the name', () => {
    const map = run([
      node('i1', 'input', { name: 'dup' }),
      node('i2', 'input', { name: 'dup' }),
      node('i3', 'input', { name: 'dup' })
    ], { connected: [targetKey('i3', 'in')] })
    expect(codes(map, 'i1')).toContain('duplicate-name')
    expect(codes(map, 'i2')).toContain('duplicate-name')
    expect(map.has('i3')).toBe(false)
  })

  it('still flags duplicate params within a single predecessor-wired input', () => {
    const map = run([
      node('i1', 'input', { params: [{ id: 'a', name: 'x' }, { id: 'b', name: 'x' }] })
    ], { connected: [targetKey('i1', 'in')] })
    expect(codes(map, 'i1')).toContain('duplicate-name')
  })

  it('flags an input with NO params (the empty default row must declare a name)', () => {
    expect(codes(run([node('i', 'input', {})]), 'i')).toContain('missing-name')
    expect(codes(run([node('i', 'input', { params: [] })]), 'i')).toContain('missing-name')
  })

  it('flags two predecessor-less setVariables sharing a name (ambiguous up-front seed)', () => {
    const map = run([
      node('s1', 'setVariable', { name: 'x' }),
      node('s2', 'setVariable', { name: 'x' })
    ])
    expect(codes(map, 's1')).toContain('duplicate-name')
    expect(codes(map, 's2')).toContain('duplicate-name')
  })

  it('allows two setVariables with the same name once one runs mid-flow (legit re-assignment)', () => {
    // `s2` has a predecessor (wired `in`), so it runs mid-flow — writing the same
    // variable is the normal mutation pattern. `s1` is then the sole up-front
    // declaration, so neither collides.
    const map = run([
      node('s1', 'setVariable', { name: 'x' }),
      node('s2', 'setVariable', { name: 'x' })
    ], { connected: [targetKey('s2', 'in')] })
    expect(codes(map, 's1')).not.toContain('duplicate-name')
    expect(codes(map, 's2')).not.toContain('duplicate-name')
  })

  it('a setVariable with a wired VALUE also counts as mid-flow (exempt)', () => {
    const map = run([
      node('s1', 'setVariable', { name: 'x' }),
      node('s2', 'setVariable', { name: 'x' })
    ], { connected: [targetKey('s2', 'value')] })
    expect(codes(map, 's1')).not.toContain('duplicate-name')
    expect(codes(map, 's2')).not.toContain('duplicate-name')
  })

  it('flags a free setVariable colliding with a free input param (on BOTH sides)', () => {
    const map = run([
      node('i1', 'input', { name: 'x' }),
      node('s1', 'setVariable', { name: 'x' })
    ])
    expect(codes(map, 'i1')).toContain('duplicate-name')
    expect(codes(map, 's1')).toContain('duplicate-name')
  })

  it('a named legacy single output is valid whether its value is wired or not', () => {
    // Legacy `{ name }` migrates to one decl on the `value` port. A name is all
    // it needs — an unwired value is fine (it emits an empty string).
    expect(run([node('o', 'output', { name: 'out' })]).has('o')).toBe(false)
    expect(run([node('o', 'output', { name: 'out' })], { connected: [targetKey('o', 'value')] }).has('o')).toBe(false)
  })

  it('flags an output with NO decls (the empty default row must declare a name)', () => {
    expect(codes(run([node('o', 'output', {})]), 'o')).toContain('missing-name')
    expect(codes(run([node('o', 'output', { outputs: [] })]), 'o')).toContain('missing-name')
  })

  it('validates a MULTI-output node per decl (names only; an unwired value is fine)', () => {
    const decls = [{ id: 'd1', name: 'a' }, { id: 'd2', name: 'b' }, { id: 'd3', name: '' }]
    const map = run([node('o', 'output', { outputs: decls })], { connected: [targetKey('o', 'd1')] })
    const byField = (map.get('o') ?? []).map((e) => [e.code, e.field])
    // Only the blank-named decl errors; an unwired value (d2) is NOT an error —
    // an output simply emits its literal (an empty string by default).
    expect(byField).toEqual([['missing-name', 'd3']])
    expect(byField.some(([, f]) => f === 'd1' || f === 'd2')).toBe(false)
  })

  it('flags duplicate output names across decls / nodes', () => {
    const map = run([
      node('o1', 'output', { outputs: [{ id: 'd1', name: 'dup' }] }),
      node('o2', 'output', { outputs: [{ id: 'd2', name: 'dup' }] })
    ], { connected: [targetKey('o1', 'd1'), targetKey('o2', 'd2')] })
    expect(codes(map, 'o1')).toContain('duplicate-name')
    expect(codes(map, 'o2')).toContain('duplicate-name')
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

describe('validateScenarioModel — engine/MCP gate from the persisted model', () => {
  it('derives errors straight from a scenario model (duplicate input names)', () => {
    const scenario = {
      nodes: [
        { id: 'i1', kind: 'input', config: { name: 'dup' }, inputs: [], outputs: [] },
        { id: 'i2', kind: 'input', config: { name: 'dup' }, inputs: [], outputs: [] }
      ],
      edges: []
    }
    const byNode = validateScenarioModel(scenario as never, t)
    expect(codes(byNode, 'i1')).toContain('duplicate-name')
    expect(codes(byNode, 'i2')).toContain('duplicate-name')
  })

  it('passes a clean model', () => {
    const scenario = { nodes: [{ id: 'i1', kind: 'input', config: { name: 'ok' }, inputs: [], outputs: [] }], edges: [] }
    expect(validateScenarioModel(scenario as never, t).size).toBe(0)
  })

  it('flags readFile / writeFile with no path (inline empty, not wired)', () => {
    expect(codes(run([node('r', 'readFile', { path: { type: 'string', value: '   ' } })]), 'r')).toEqual(['missing-path'])
    expect(codes(run([node('w', 'writeFile')]), 'w')).toEqual(['missing-path'])
  })

  it('passes readFile with an inline path, or a wired path', () => {
    expect(run([node('r', 'readFile', { path: { type: 'string', value: 'data.json' } })]).has('r')).toBe(false)
    expect(run([node('w', 'writeFile')], { connected: [targetKey('w', 'path')] }).has('w')).toBe(false)
  })

  it('derives connectedTargets from edges (a wired ÷ operand resolves at run time)', () => {
    const scenario = {
      nodes: [
        { id: 'src', kind: 'now', config: {}, inputs: [], outputs: [{ id: 'value', name: 'value', dataType: 'any' }] },
        { id: 'a', kind: 'arithmetic', config: { operator: '÷' }, inputs: [{ id: 'b', name: 'b', dataType: 'number' }], outputs: [] }
      ],
      // `.` identity selector keeps the data-link rule happy; the edge proves the
      // connectedTargets derivation suppresses the division-by-zero error.
      edges: [{ id: 'e', from: { nodeId: 'src', portId: 'value' }, to: { nodeId: 'a', portId: 'b' }, selector: '.' }]
    }
    expect(validateScenarioModel(scenario as never, t).has('a')).toBe(false)
  })
})
