import { describe, it, expect } from 'vitest'
import { assertPathWithinParent, isPathContained } from './pathSecurity'

describe('assertPathWithinParent', () => {
  it('accepts a child inside the parent', () => {
    expect(() => { assertPathWithinParent('/home/user/project', '/home/user/project/secrets.env') }).not.toThrow()
  })

  it('accepts the parent itself', () => {
    expect(() => { assertPathWithinParent('/home/user/project', '/home/user/project') }).not.toThrow()
  })

  it('rejects a sibling escape', () => {
    expect(() => { assertPathWithinParent('/home/user/project', '/home/user/other/secrets.env') }).toThrow(/traversal/)
  })

  it('rejects a ../ traversal', () => {
    expect(() => { assertPathWithinParent('/home/user/project', '/home/user/project/../../etc/passwd') }).toThrow(/traversal/)
  })
})

describe('isPathContained (fail-closed)', () => {
  it('returns true for a contained path', () => {
    expect(isPathContained('/home/user/project', '/home/user/project/secrets.env')).toBe(true)
  })

  it('returns true when the target equals the container', () => {
    expect(isPathContained('/home/user/project', '/home/user/project')).toBe(true)
  })

  // The regression: when no folder is open the old code skipped the
  // guard entirely (fail-OPEN), letting a raw renderer path through.
  it('returns false when the container is null/undefined/empty', () => {
    expect(isPathContained(null, '/etc/passwd')).toBe(false)
    expect(isPathContained(undefined, '/etc/passwd')).toBe(false)
    expect(isPathContained('', '/etc/passwd')).toBe(false)
  })

  it('returns false for an escaping target even with a valid container', () => {
    expect(isPathContained('/home/user/project', '/home/user/other/x')).toBe(false)
    expect(isPathContained('/home/user/project', '/etc/passwd')).toBe(false)
  })

  it('returns false for an empty target', () => {
    expect(isPathContained('/home/user/project', '')).toBe(false)
  })
})
