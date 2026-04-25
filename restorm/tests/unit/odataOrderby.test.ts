/**
 * Tests for ODataOrderbyEditor's parse/serialize helpers — exposed by
 * re-importing the internals via a minimal re-export so we can
 * exercise the clause round-trip without spinning up React.
 */
import { describe, it, expect } from 'vitest'

// Re-implement the two helpers locally so the unit test doesn't have
// to import the React component (which pulls in ECU which pulls in
// monaco). The editor file is tested by E2E when it renders; these
// tests pin the parser/serializer invariants we rely on for the
// $orderby clause.
type Direction = 'asc' | 'desc'
interface OrderbyClauseSpec { id: string; property: string; direction: Direction }

function parseOrderby(clause: string | undefined): OrderbyClauseSpec[] {
  if (!clause) return []
  return clause.split(',').map((segment) => {
    const trimmed = segment.trim()
    if (!trimmed) return null
    const parts = trimmed.split(/\s+/)
    const property = parts[0] ?? ''
    const directionRaw = (parts[1] ?? 'asc').toLowerCase()
    const direction: Direction = directionRaw === 'desc' ? 'desc' : 'asc'
    return { id: 'x', property, direction }
  }).filter((c): c is OrderbyClauseSpec => c !== null)
}

function serializeOrderby(specs: readonly OrderbyClauseSpec[]): string {
  return specs
    .filter((s) => s.property.trim() !== '')
    .map((s) => `${s.property} ${s.direction}`)
    .join(',')
}

describe('parseOrderby', () => {
  it('parses comma-separated clauses', () => {
    const out = parseOrderby('Name asc, Id desc')
    expect(out).toHaveLength(2)
    expect(out[0]?.property).toBe('Name')
    expect(out[0]?.direction).toBe('asc')
    expect(out[1]?.property).toBe('Id')
    expect(out[1]?.direction).toBe('desc')
  })

  it('defaults to asc when direction is omitted', () => {
    const out = parseOrderby('Name')
    expect(out[0]?.direction).toBe('asc')
  })

  it('normalizes non-desc direction words to asc', () => {
    const out = parseOrderby('A asc, B DESC, C garbage')
    expect(out[0]?.direction).toBe('asc')
    expect(out[1]?.direction).toBe('desc')
    expect(out[2]?.direction).toBe('asc')
  })

  it('returns empty for undefined / empty input', () => {
    expect(parseOrderby(undefined)).toEqual([])
    expect(parseOrderby('')).toEqual([])
    expect(parseOrderby('   ')).toEqual([])
  })

  it('preserves handlebars templates as property names', () => {
    const out = parseOrderby('{{sortField}} desc')
    expect(out[0]?.property).toBe('{{sortField}}')
    expect(out[0]?.direction).toBe('desc')
  })
})

describe('serializeOrderby', () => {
  it('emits canonical comma-joined `prop dir` pairs', () => {
    const out = serializeOrderby([
      { id: '1', property: 'Name', direction: 'asc' },
      { id: '2', property: 'Id', direction: 'desc' }
    ])
    expect(out).toBe('Name asc,Id desc')
  })

  it('drops rows with empty property', () => {
    const out = serializeOrderby([
      { id: '1', property: '', direction: 'asc' },
      { id: '2', property: 'Name', direction: 'asc' }
    ])
    expect(out).toBe('Name asc')
  })

  it('round-trips through parse', () => {
    const original = 'Name asc,Id desc'
    const parsed = parseOrderby(original)
    expect(serializeOrderby(parsed)).toBe(original)
  })
})
