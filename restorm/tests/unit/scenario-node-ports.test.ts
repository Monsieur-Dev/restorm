import { describe, it, expect } from 'vitest'
import { defaultPortsForKind, isValidScenarioConnection } from '../../src/renderer/src/components/Scenario/scenarioNodePorts'
import type { ScenarioNodeKind } from '../../src/shared/types/scenario'

describe('defaultPortsForKind', () => {
  it('gives If a header launch trigger, left/right operands and a then/else branch', () => {
    const { inputs, outputs } = defaultPortsForKind('if')
    expect(inputs.map((p) => p.id)).toEqual(['in', 'left', 'right'])
    expect(inputs[0]).toMatchObject({ id: 'in', flow: 'signal' })
    expect(outputs.map((p) => p.id)).toEqual(['then', 'else'])
    expect(outputs.map((p) => p.role)).toEqual(['then', 'else'])
  })

  it('gives Input a value output and an optional signal launch trigger', () => {
    const { inputs, outputs } = defaultPortsForKind('input')
    expect(outputs).toHaveLength(1)
    // A generic output carries a value AND triggers → `both` (violet/yellow).
    expect(outputs[0]).toMatchObject({ id: 'value', flow: 'both' })
    expect(inputs).toContainEqual(expect.objectContaining({ id: 'in', flow: 'signal' }))
  })

  it('gives Request a typed response output', () => {
    const { outputs } = defaultPortsForKind('httpRequest')
    expect(outputs[0]).toMatchObject({ id: 'response', role: 'response', dataType: 'response' })
  })

  it('gives ForEach an `each` output + a header trigger; completion is the universal Done', () => {
    const { inputs, outputs } = defaultPortsForKind('forEach')
    // No explicit `done` output — loop completion is the implicit universal `Done` port.
    expect(outputs.map((p) => p.id)).toEqual(['each'])
    // Optional header `in` trigger to sequence the loop.
    expect(inputs.map((p) => p.id)).toEqual(['in', 'items'])
  })

  it('gives For + setVariable a header trigger, and setVariable no `event` output', () => {
    expect(defaultPortsForKind('for').inputs.map((p) => p.id)).toEqual(['in', 'from', 'to', 'step'])
    const sv = defaultPortsForKind('setVariable')
    expect(sv.inputs.map((p) => p.id)).toEqual(['in', 'value'])
    // `event` removed — completion chains via the universal Done.
    expect(sv.outputs).toEqual([])
  })

  it('falls back to a generic in/out for an unspecified kind', () => {
    const { inputs, outputs } = defaultPortsForKind('now')
    // `now` is specified (no input); use a truly generic one to prove fallback.
    expect(inputs.length + outputs.length).toBeGreaterThan(0)
    const generic = defaultPortsForKind('transform')
    // `transform` carries a header launch trigger (`in`) plus its optional
    // `value` input and the optional `expression` input (wire the template).
    expect(generic.inputs.map((p) => p.id)).toEqual(['in', 'value', 'expression'])
  })

  it('returns fresh arrays each call (no shared mutable state)', () => {
    const a = defaultPortsForKind('if')
    const b = defaultPortsForKind('if')
    expect(a.outputs).not.toBe(b.outputs)
    a.outputs.push({ id: 'x', name: 'x', dataType: 'any' })
    expect(b.outputs).toHaveLength(2)
  })
})

describe('isValidScenarioConnection (link flow rules)', () => {
  const link = (srcKind: ScenarioNodeKind, srcHandle: string, tgtKind: ScenarioNodeKind, tgtHandle: string): boolean =>
    isValidScenarioConnection({
      sourceKind: srcKind,
      sourceOutputs: defaultPortsForKind(srcKind).outputs,
      sourceHandle: srcHandle,
      targetKind: tgtKind,
      targetInputs: defaultPortsForKind(tgtKind).inputs,
      targetHandle: tgtHandle
    })

  // The ONLY forbidden combination: a pure-SIGNAL output into a pure-DATA
  // input. The pure signals are the while/doWhile body (`then`) and the
  // implicit `done` — they carry no value, so they can't populate an operand.
  it('rejects the while body (signal) into a data operand (while.then → arithmetic.a)', () => {
    expect(link('while', 'then', 'arithmetic', 'a')).toBe(false)
  })
  it('rejects the doWhile body (signal) into a data operand', () => {
    expect(link('doWhile', 'then', 'arithmetic', 'b')).toBe(false)
  })
  it('rejects the implicit `done` signal into a data operand', () => {
    expect(link('setVariable', 'done', 'arithmetic', 'a')).toBe(false)
  })
  it('allows the while body (signal) into a header trigger (while.then → arithmetic.in)', () => {
    expect(link('while', 'then', 'arithmetic', 'in')).toBe(true)
  })
  it('allows the implicit `done` signal into a header trigger', () => {
    expect(link('setVariable', 'done', 'httpRequest', 'in')).toBe(true)
  })
  // Every other output is `both` — a value that ALSO triggers — so it feeds
  // either a data operand OR a header trigger.
  it('allows a data output into a header trigger (now.value → httpRequest.in)', () => {
    expect(link('now', 'value', 'httpRequest', 'in')).toBe(true)
  })
  it('allows a data output into a data input (now.value → log.data)', () => {
    expect(link('now', 'value', 'log', 'data')).toBe(true)
  })
  it('allows an if branch (both) into a data operand — it carries the passthrough value', () => {
    expect(link('if', 'then', 'arithmetic', 'a')).toBe(true)
  })
  it('allows an if branch (both) into a header trigger', () => {
    expect(link('if', 'then', 'switch', 'in')).toBe(true)
  })
  it('allows the response (both) into a header trigger (chaining)', () => {
    expect(link('httpRequest', 'response', 'httpRequest', 'in')).toBe(true)
  })
  it('allows the error port into a header trigger', () => {
    expect(link('httpRequest', 'error', 'httpRequest', 'in')).toBe(true)
  })
  // Legacy flow-less ports: a while/doWhile `then` still derives `signal` (so
  // it's still rejected into a data input); every other flow-less output
  // derives `both`.
  it('derives signal for a flow-less (legacy) while body → still rejected into a data input', () => {
    expect(isValidScenarioConnection({
      sourceKind: 'while',
      sourceOutputs: [{ id: 'then', name: 'body', dataType: 'any', role: 'then' }],
      sourceHandle: 'then',
      targetKind: 'arithmetic',
      targetInputs: [{ id: 'a', name: 'a', dataType: 'any' }],
      targetHandle: 'a'
    })).toBe(false)
  })
  it('derives both for a flow-less (legacy) if branch → allowed into a data input', () => {
    expect(isValidScenarioConnection({
      sourceKind: 'if',
      sourceOutputs: [{ id: 'then', name: 'then', dataType: 'any', role: 'then' }],
      sourceHandle: 'then',
      targetKind: 'arithmetic',
      targetInputs: [{ id: 'a', name: 'a', dataType: 'any' }],
      targetHandle: 'a'
    })).toBe(true)
  })
})
