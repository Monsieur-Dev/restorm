import { describe, it, expect } from 'vitest'
import { linkPaletteEntries } from './scenarioLinkPalette'
import { defaultPortsForKind } from './scenarioNodePorts'
import type { ScenarioNodeKind } from '../../../../shared/types/collections'

/** A source node shaped from a kind's canonical ports. */
const srcOf = (kind: ScenarioNodeKind): { kind: ScenarioNodeKind; inputs: ReturnType<typeof defaultPortsForKind>['inputs']; outputs: ReturnType<typeof defaultPortsForKind>['outputs'] } => {
  const p = defaultPortsForKind(kind)
  return { kind, inputs: p.inputs, outputs: p.outputs }
}

describe('linkPaletteEntries — drag from an output', () => {
  // Example 1: a request's `response` (a typed `both` output, type `response`)
  // → wait, whose only data input `duration` is a `duration` — incompatible —
  // so it falls back to the event/header input.
  it('a typed output with no compatible data input falls back to the event input (response → wait → in)', () => {
    const entries = linkPaletteEntries(srcOf('httpRequest'), 'response', true)
    expect(entries.find((e) => e.kind === 'wait')?.wirePort).toBe('in')
  })

  // Example 2: same response → `if`, whose first data input `left` is untyped
  // (`any`) → compatible, so the link prefers it over the event input.
  it('prefers the first compatible DATA input over the event input (if → left)', () => {
    const entries = linkPaletteEntries(srcOf('httpRequest'), 'response', true)
    expect(entries.find((e) => e.kind === 'if')?.wirePort).toBe('left')
  })

  // Example 3: a PURE signal output (the while body `then`) carries no value, so
  // it lists only kinds that own a header trigger, each wired to it — never a
  // data-driven kind (aggregate has no header, so a signal can't reach it).
  it('a pure signal (body) output lists only kinds with a header input, all wired to it', () => {
    const entries = linkPaletteEntries(srcOf('while'), 'then', true)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.wirePort === 'in')).toBe(true)
    const kinds = entries.map((e) => e.kind)
    expect(kinds).toContain('wait')
    expect(kinds).toContain('arithmetic') // owns a header trigger → wired to `in`
    expect(kinds).not.toContain('aggregate') // no header → a signal can't reach it
  })

  // Example 4: an untyped (`any`) `both` output (waitUntil's `out`) is
  // compatible with every data input, so it wires to each kind's FIRST data
  // input — `wait`'s `duration`, `aggregate`'s `items` — not the event input.
  it('an `any` output wires to each kind`s first data input', () => {
    const entries = linkPaletteEntries(srcOf('waitUntil'), 'out', true)
    expect(entries.find((e) => e.kind === 'wait')?.wirePort).toBe('duration')
    expect(entries.find((e) => e.kind === 'aggregate')?.wirePort).toBe('items')
  })

  // The env/string rule: a typed output picks the FIRST input whose type it
  // matches, skipping an earlier incompatible one. `arithmetic.result` is a
  // `number`; a second arithmetic's first data input `a` is a `number` → it
  // wires there (not the event input, not a later port).
  it('a number output wires to the first number data input (arithmetic → a)', () => {
    const entries = linkPaletteEntries(srcOf('arithmetic'), 'result', true)
    expect(entries.find((e) => e.kind === 'arithmetic')?.wirePort).toBe('a')
  })

  // A pure-signal source (no value) can never feed a data input, so it always
  // lands on the event/header — even on a kind that has data inputs (`if`).
  it('a pure signal output always wires to the event input, never a data input (if → in)', () => {
    const entries = linkPaletteEntries(srcOf('while'), 'then', true)
    expect(entries.find((e) => e.kind === 'if')?.wirePort).toBe('in')
  })

  it('lists getVariable (it now owns a header launch trigger), wired to it', () => {
    const entries = linkPaletteEntries(srcOf('httpRequest'), 'response', true)
    expect(entries.find((e) => e.kind === 'getVariable')?.wirePort).toBe('in')
  })

  it('lists input (it owns a header launch trigger), wired to it', () => {
    const entries = linkPaletteEntries(srcOf('httpRequest'), 'response', true)
    expect(entries.find((e) => e.kind === 'input')?.wirePort).toBe('in')
  })
})
