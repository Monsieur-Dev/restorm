import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-core-ui/renderer', () => ({
  // Mirror the real computeChecksum contract closely enough for this test:
  // a deterministic non-empty checksum for serializable input, '' when its
  // own stringify throws.
  computeChecksum: (data: unknown): string => {
    try {
      return `ck:${JSON.stringify(data).length}`
    } catch {
      return ''
    }
  }
}))

import { computeChecksumSnapshot } from './computeChecksumSnapshot'

describe('computeChecksumSnapshot', () => {
  it('returns a deterministic checksum for a normal document', () => {
    const doc = { id: 'f1', name: 'Folder', items: [{ id: 'r1', name: 'req' }] }
    const a = computeChecksumSnapshot(doc)
    const b = computeChecksumSnapshot(doc)
    expect(a).toBe(b)
    expect(a).not.toBe('')
  })

  it('returns "" for a document too large to serialize instead of throwing', () => {
    // The oversized-project failure: the pre-clone JSON.stringify throws
    // `RangeError: Invalid string length`. The helper must swallow THAT into
    // '' — never let it escape (that is the unhandled crash we are fixing).
    const oversized = {
      toJSON(): never {
        throw new RangeError('Invalid string length')
      }
    }
    expect(() => computeChecksumSnapshot(oversized)).not.toThrow()
    expect(computeChecksumSnapshot(oversized)).toBe('')
  })

  it('rethrows a non-RangeError (a genuine bug) unchanged', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    // Circular structure throws a TypeError — a real defect that must not be
    // masked as "too large".
    expect(() => computeChecksumSnapshot(circular)).toThrow(TypeError)
  })
})
