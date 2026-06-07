import { describe, it, expect } from 'vitest'
import type { ScenarioPort, ScenarioPortRole } from '../../../../shared/types/collections'
import { portColor, edgeColorForHandle } from './scenarioGraphMapping'

const GREEN = '#22c55e'
const BLUE = '#3b82f6'
const RED = '#ef4444'

function port(role: ScenarioPortRole): ScenarioPort {
  return { id: role, name: role, dataType: 'any', role }
}

describe('scenarioGraphMapping — port/edge colours (classic vs alternative)', () => {
  it('paints the "classic" outputs green', () => {
    // `then` (if), `default` (switch fall-through) and `response` are the
    // normal/happy outputs → green.
    expect(portColor(port('then'))).toBe(GREEN)
    expect(portColor(port('default'))).toBe(GREEN)
    expect(portColor(port('response'))).toBe(GREEN)
  })

  it('paints the "alternative" outputs blue', () => {
    // `else` (if) and `case` (switch specific branches) are alternatives → blue.
    expect(portColor(port('else'))).toBe(BLUE)
    expect(portColor(port('case'))).toBe(BLUE)
  })

  it('resolves the implicit done/error handles by id', () => {
    // `done` (universal completion) + `error` aren't in any kind's output list,
    // so they carry no port role — resolve them by handle id.
    expect(edgeColorForHandle('done', undefined)).toBe(GREEN)
    expect(edgeColorForHandle('error', undefined)).toBe(RED)
  })

  it('falls back to the port role for every other handle', () => {
    expect(edgeColorForHandle('then', port('then'))).toBe(GREEN)
    expect(edgeColorForHandle('case', port('case'))).toBe(BLUE)
    expect(edgeColorForHandle('whatever', undefined)).toBeUndefined()
  })
})
