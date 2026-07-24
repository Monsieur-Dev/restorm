import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertPathWithinParent, isPathContained, resolveOpenedFolderBoundary } from './pathSecurity'

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

describe('resolveOpenedFolderBoundary', () => {
  let root: string
  let projectFolder: string
  let siblingFolder: string
  let projectFile: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'restorm-path-security-'))
    projectFolder = join(root, 'my-project')
    siblingFolder = join(root, 'other-project')
    projectFile = join(root, 'single.restorm')
    mkdirSync(projectFolder)
    mkdirSync(siblingFolder)
    writeFileSync(projectFile, '{}', 'utf-8')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  // The boundary must be the folder ITSELF. Deriving it with `dirname()`
  // would return `root`, which contains every sibling project.
  it('returns the opened folder itself, not its parent', () => {
    expect(resolveOpenedFolderBoundary(projectFolder)).toBe(projectFolder)
  })

  it('returns null for a single opened file (no folder boundary applies)', () => {
    expect(resolveOpenedFolderBoundary(projectFile)).toBeNull()
  })

  it('returns null when nothing is open', () => {
    expect(resolveOpenedFolderBoundary(null)).toBeNull()
    expect(resolveOpenedFolderBoundary(undefined)).toBeNull()
    expect(resolveOpenedFolderBoundary('')).toBeNull()
  })

  it('returns null for a path that no longer exists', () => {
    expect(resolveOpenedFolderBoundary(join(root, 'gone'))).toBeNull()
  })

  // The composed decision the save-as-folder handler makes. Before the
  // boundary resolved to a real value this evaluated to "no container",
  // so the containment check never ran and every target was accepted.
  describe('composed with isPathContained, as the save-as-folder guard does', () => {
    it('admits a re-save of the opened folder itself', () => {
      const boundary = resolveOpenedFolderBoundary(projectFolder)
      expect(isPathContained(boundary, projectFolder)).toBe(true)
    })

    it('admits a target nested inside the opened folder', () => {
      const boundary = resolveOpenedFolderBoundary(projectFolder)
      expect(isPathContained(boundary, join(projectFolder, 'nested'))).toBe(true)
    })

    it('refuses a sibling project', () => {
      const boundary = resolveOpenedFolderBoundary(projectFolder)
      expect(isPathContained(boundary, siblingFolder)).toBe(false)
    })

    // Passed raw, exactly as a renderer would send it — `join()` would
    // normalise the `..` away before the guard ever saw it.
    it('refuses a ../ traversal out of the opened folder', () => {
      const boundary = resolveOpenedFolderBoundary(projectFolder)
      expect(isPathContained(boundary, '../other-project')).toBe(false)
      expect(isPathContained(boundary, `${projectFolder}/../other-project`)).toBe(false)
    })

    it('refuses a foreign absolute path', () => {
      const boundary = resolveOpenedFolderBoundary(projectFolder)
      expect(isPathContained(boundary, '/etc/passwd')).toBe(false)
    })
  })
})
