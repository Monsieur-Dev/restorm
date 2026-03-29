import { describe, it, expect } from 'vitest'
import { assertPathWithinParent } from '../../src/main/utils/pathSecurity'

describe('assertPathWithinParent', () => {
  it('allows paths within parent', () => {
    expect(() => {
      assertPathWithinParent('/data', 'subfolder/file.json')
    }).not.toThrow()
  })
  it('rejects ../ traversal', () => {
    expect(() => {
      assertPathWithinParent('/data', '../etc/passwd')
    }).toThrow('Path traversal detected')
  })
  it('rejects absolute paths outside parent', () => {
    expect(() => {
      assertPathWithinParent('/data', '/etc/passwd')
    }).toThrow('Path traversal detected')
  })
  it('allows nested paths', () => {
    expect(() => {
      assertPathWithinParent('/data', 'a/b/c/file.txt')
    }).not.toThrow()
  })
  it('allows same directory', () => {
    expect(() => {
      assertPathWithinParent('/data', 'file.txt')
    }).not.toThrow()
  })
})
