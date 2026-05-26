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
  // Example 1: a request's `response` (a `both` output) → wait, which has a
  // header input → wire to the header.
  it('a response (both) output wires to the header input when the kind has one (wait → in)', () => {
    const entries = linkPaletteEntries(srcOf('httpRequest'), 'response', true)
    expect(entries.find((e) => e.kind === 'wait')?.wirePort).toBe('in')
  })

  // Example 2: same response → `if`, which has a header launch trigger → wire
  // to the header (its left/right operands are set via the value selectors).
  it('a response (both) output wires to the header input when the kind has one (if → in)', () => {
    const entries = linkPaletteEntries(srcOf('httpRequest'), 'response', true)
    expect(entries.find((e) => e.kind === 'if')?.wirePort).toBe('in')
  })

  // Example 3: a trigger output (waitUntil's `out`, flow signal) → only kinds
  // that own a header input, each wired to it.
  it('a signal (trigger) output lists only kinds with a header input, all wired to it', () => {
    const entries = linkPaletteEntries(srcOf('waitUntil'), 'out', true)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.wirePort === 'in')).toBe(true)
    const kinds = entries.map((e) => e.kind)
    expect(kinds).toContain('wait')
    expect(kinds).toContain('httpRequest')
    expect(kinds).toContain('if') // now owns a header launch trigger
    expect(kinds).not.toContain('arithmetic')
  })

  it('omits kinds that have no input at all', () => {
    const kinds = linkPaletteEntries(srcOf('httpRequest'), 'response', true).map((e) => e.kind)
    expect(kinds).not.toContain('getVariable')
  })

  it('lists input (it owns a header launch trigger), wired to it', () => {
    const entries = linkPaletteEntries(srcOf('httpRequest'), 'response', true)
    expect(entries.find((e) => e.kind === 'input')?.wirePort).toBe('in')
  })
})
