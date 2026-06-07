import { describe, it, expect } from 'vitest'
import { isAbsolute, resolve } from 'node:path'
import { resolveWorkspacePath } from './scenarioFilePath'

describe('resolveWorkspacePath', () => {
  it('returns an absolute path INSIDE the workspace unchanged', () => {
    const inside = resolve('/some/workspace', 'x.json') // /some/workspace/x.json
    expect(resolveWorkspacePath(inside, '/some/workspace')).toBe(inside)
  })

  it('THROWS on an absolute path outside the workspace', () => {
    const outside = isAbsolute('/etc/passwd') ? '/etc/passwd' : resolve('/etc/passwd')
    expect(() => resolveWorkspacePath(outside, '/some/workspace')).toThrow(/escapes the workspace/)
  })

  it('resolves a relative path against the workspace dir', () => {
    expect(resolveWorkspacePath('data.json', '/some/workspace')).toBe(resolve('/some/workspace', 'data.json'))
    expect(resolveWorkspacePath('sub/data.json', '/some/workspace')).toBe(resolve('/some/workspace', 'sub/data.json'))
  })

  it('allows a relative path that stays within the workspace after normalization', () => {
    expect(resolveWorkspacePath('sub/../data.json', '/some/workspace')).toBe(resolve('/some/workspace', 'data.json'))
  })

  it('THROWS on a relative path that escapes the workspace', () => {
    expect(() => resolveWorkspacePath('../secret.json', '/some/workspace')).toThrow(/escapes the workspace/)
    expect(() => resolveWorkspacePath('sub/../../secret.json', '/some/workspace')).toThrow(/escapes the workspace/)
  })

  it('resolves against cwd when there is no workspace dir', () => {
    expect(resolveWorkspacePath('data.json')).toBe(resolve('data.json'))
    expect(resolveWorkspacePath('data.json', '')).toBe(resolve('data.json'))
  })

  it('throws on an empty path', () => {
    expect(() => resolveWorkspacePath('', '/ws')).toThrow()
    expect(() => resolveWorkspacePath('   ', '/ws')).toThrow()
  })
})
