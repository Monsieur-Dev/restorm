import { describe, it, expect } from 'vitest'
import {
  serializeRunLogEntries,
  serializeRunLogEntry,
  filterUserLogs,
  type ScenarioRunLogLike
} from './serializeRunLog'

const ENTRY: ScenarioRunLogLike = {
  ts: '2026-06-08T10:11:12.345Z',
  level: 'info',
  source: 'user',
  message: 'Hello world'
}

describe('serializeRunLog', () => {
  it('serializes one entry as `<emoji> [date] text`', () => {
    expect(serializeRunLogEntry(ENTRY)).toBe('message: 🔵 [2026-06-08 10:11:12.345] Hello world\n')
  })

  it('maps each level to its emoji', () => {
    const at = (level: ScenarioRunLogLike['level']): string =>
      serializeRunLogEntry({ ...ENTRY, level })
    expect(at('debug')).toContain('⚪ [')
    expect(at('info')).toContain('🔵 [')
    expect(at('warn')).toContain('🟠 [')
    expect(at('error')).toContain('🔴 [')
  })

  it('defaults a missing level to info', () => {
    const { level: _omitted, ...noLevel } = ENTRY
    expect(serializeRunLogEntry(noLevel)).toContain('🔵 [')
  })

  it('includes structured `data` as a second property when present', () => {
    const out = serializeRunLogEntry({ ...ENTRY, data: { a: 1, b: 'x' } })
    expect(out).toContain('message: 🔵 [2026-06-08 10:11:12.345] Hello world')
    expect(out).toContain('data:')
    expect(out).toContain('a: 1')
    expect(out).toContain('b: x')
  })

  it('coerces a non-string message defensively', () => {
    const out = serializeRunLogEntry({ ...ENTRY, message: { type: 'string', value: 'v' } as unknown as string })
    expect(out).toContain('{"type":"string","value":"v"}')
  })

  it('serializes a batch as a YAML sequence', () => {
    const out = serializeRunLogEntries([ENTRY, { ...ENTRY, message: 'Second' }])
    expect(out).toBe(
      '- message: 🔵 [2026-06-08 10:11:12.345] Hello world\n' +
      '- message: 🔵 [2026-06-08 10:11:12.345] Second\n'
    )
  })

  // The CLI streamer emits each entry through the array form so it concatenates
  // into exactly the batch output — this is the byte-identity invariant.
  it('per-entry array form concatenates to the batch output', () => {
    const entries = [ENTRY, { ...ENTRY, message: 'Second' }, { ...ENTRY, message: 'Third', data: [1, 2] }]
    const streamed = entries.map((e) => serializeRunLogEntries([e])).join('')
    expect(streamed).toBe(serializeRunLogEntries(entries))
  })

  it('filterUserLogs keeps only user entries unless showAll', () => {
    const logs: ScenarioRunLogLike[] = [
      { ts: ENTRY.ts, source: 'user', message: 'u' },
      { ts: ENTRY.ts, source: 'engine', message: 'e' },
      { ts: ENTRY.ts, source: 'run', message: 'r' }
    ]
    expect(filterUserLogs(logs, false).map((e) => e.message)).toEqual(['u'])
    expect(filterUserLogs(logs, true).map((e) => e.message)).toEqual(['u', 'e', 'r'])
  })
})
