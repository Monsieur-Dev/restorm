import { describe, it, expect } from 'vitest'
import { defaultPortsForKind } from '../../src/renderer/src/components/Scenario/scenarioNodePorts'

describe('defaultPortsForKind', () => {
  it('gives If left/right operands and a then/else branch', () => {
    const { inputs, outputs } = defaultPortsForKind('if')
    expect(inputs.map((p) => p.id)).toEqual(['left', 'right'])
    expect(outputs.map((p) => p.id)).toEqual(['then', 'else'])
    expect(outputs.map((p) => p.role)).toEqual(['then', 'else'])
  })

  it('gives Start an output but no input', () => {
    const { inputs, outputs } = defaultPortsForKind('start')
    expect(inputs).toHaveLength(0)
    expect(outputs).toHaveLength(1)
  })

  it('gives Request a typed response output', () => {
    const { outputs } = defaultPortsForKind('request')
    expect(outputs[0]).toMatchObject({ id: 'response', role: 'response', dataType: 'response' })
  })

  it('gives ForEach each/done outputs', () => {
    expect(defaultPortsForKind('forEach').outputs.map((p) => p.id)).toEqual(['each', 'done'])
  })

  it('falls back to a generic in/out for an unspecified kind', () => {
    const { inputs, outputs } = defaultPortsForKind('now')
    // `now` is specified (no input); use a truly generic one to prove fallback.
    expect(inputs.length + outputs.length).toBeGreaterThan(0)
    const generic = defaultPortsForKind('transform')
    expect(generic.inputs.map((p) => p.id)).toEqual(['value'])
  })

  it('returns fresh arrays each call (no shared mutable state)', () => {
    const a = defaultPortsForKind('if')
    const b = defaultPortsForKind('if')
    expect(a.outputs).not.toBe(b.outputs)
    a.outputs.push({ id: 'x', name: 'x', dataType: 'any' })
    expect(b.outputs).toHaveLength(2)
  })
})
