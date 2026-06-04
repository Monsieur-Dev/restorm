import { describe, it, expect } from 'vitest'
import { linkPaletteEntries } from './scenarioLinkPalette'
import { defaultPortsForKind } from './scenarioNodePorts'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from '../../../../shared/scenarioListMutationValues'
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
  // it can only reach a header trigger — and EVERY kind now carries one (incl.
  // the data-driven nodes and the `output` sink), so each candidate is wired to
  // its `in`.
  it('a pure signal (body) output lists kinds by their header input, all wired to it', () => {
    const entries = linkPaletteEntries(srcOf('while'), 'then', true)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.wirePort === 'in')).toBe(true)
    const kinds = entries.map((e) => e.kind)
    expect(kinds).toContain('wait')
    expect(kinds).toContain('arithmetic') // owns a header trigger → wired to `in`
    expect(kinds).toContain('aggregate') // data-driven, but owns the trigger too
    expect(kinds).toContain('output') // the sink can be sequenced now too
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

  // An `object` output (type `object`) is NOT a list, so on AddToList/RemoveFromList
  // it skips the list-only `list` target and lands on the first VALUE row — you
  // want to ADD the object as an element, not set it as the target list.
  it('an object output → AddToList/RemoveFromList lands on the first value row, not the list target', () => {
    const entries = linkPaletteEntries(srcOf('object'), 'object', true)
    expect(entries.find((e) => e.kind === 'addToList')?.wirePort).toBe(LIST_MUTATION_DEFAULT_VALUE_ID)
    expect(entries.find((e) => e.kind === 'removeFromList')?.wirePort).toBe(LIST_MUTATION_DEFAULT_VALUE_ID)
  })

  // A list-ish output (`map.mapped` is `json`, compatible with a `list` target)
  // DOES set the `list` target.
  it('a json/list output → AddToList lands on the `list` target', () => {
    const entries = linkPaletteEntries(srcOf('map'), 'mapped', true)
    expect(entries.find((e) => e.kind === 'addToList')?.wirePort).toBe('list')
  })
})
