import { describe, it, expect } from 'vitest'
import { defaultPortsForKind, isValidScenarioConnection } from '../../src/renderer/src/components/Scenario/scenarioNodePorts'
import type { ScenarioNodeKind } from '../../src/shared/types/scenario'

describe('defaultPortsForKind', () => {
  it('gives If left/right operands and a then/else branch', () => {
    const { inputs, outputs } = defaultPortsForKind('if')
    expect(inputs.map((p) => p.id)).toEqual(['left', 'right'])
    expect(outputs.map((p) => p.id)).toEqual(['then', 'else'])
    expect(outputs.map((p) => p.role)).toEqual(['then', 'else'])
  })

  it('gives Input an output but no input (a source kind)', () => {
    const { inputs, outputs } = defaultPortsForKind('input')
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

  it('rejects a value output into a header trigger (now.value → request header)', () => {
    expect(link('now', 'value', 'request', 'in')).toBe(false)
  })
  it('rejects a signal output into a data input (if.then → switch.on)', () => {
    expect(link('if', 'then', 'switch', 'in')).toBe(false)
  })
  it('rejects a signal branch into a value input (if.then → arithmetic.a)', () => {
    expect(link('if', 'then', 'arithmetic', 'a')).toBe(false)
  })
  it('allows an AB output into a header trigger (request.response → request, chaining)', () => {
    expect(link('request', 'response', 'request', 'in')).toBe(true)
  })
  it('allows the error port into a header trigger', () => {
    expect(link('request', 'error', 'request', 'in')).toBe(true)
  })
  it('derives signal from role for a flow-less (legacy) branch output', () => {
    expect(isValidScenarioConnection({
      sourceKind: 'if',
      sourceOutputs: [{ id: 'then', name: 'then', dataType: 'any', role: 'then' }],
      sourceHandle: 'then',
      targetKind: 'arithmetic',
      targetInputs: [{ id: 'value', name: 'value', dataType: 'any' }],
      targetHandle: 'value'
    })).toBe(false)
  })
  it('allows a value output into a data input (now.value → log.value)', () => {
    expect(link('now', 'value', 'log', 'value')).toBe(true)
  })
  // Legacy header inputs (stamped before `flow`): the `in` trigger derives
  // `signal`, so a value output is still rejected and a branch is still allowed.
  it('rejects a value output into a flow-less (legacy) header input', () => {
    expect(isValidScenarioConnection({
      sourceKind: 'now',
      sourceOutputs: [{ id: 'value', name: 'now', dataType: 'string' }],
      sourceHandle: 'value',
      targetKind: 'request',
      targetInputs: [{ id: 'in', name: '', dataType: 'any' }],
      targetHandle: 'in'
    })).toBe(false)
  })
  it('allows a signal branch into a flow-less (legacy) header input', () => {
    expect(isValidScenarioConnection({
      sourceKind: 'if',
      sourceOutputs: [{ id: 'then', name: 'then', dataType: 'any', role: 'then' }],
      sourceHandle: 'then',
      targetKind: 'request',
      targetInputs: [{ id: 'in', name: '', dataType: 'any' }],
      targetHandle: 'in'
    })).toBe(true)
  })
})
