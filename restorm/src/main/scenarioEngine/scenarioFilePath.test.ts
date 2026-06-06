import { describe, it, expect } from 'vitest'
import { isAbsolute, resolve } from 'node:path'
import { resolveWorkspacePath } from './scenarioFilePath'

describe('resolveWorkspacePath', () => {
  it('returns an absolute path unchanged', () => {
    const abs = isAbsolute('/tmp/x.json') ? '/tmp/x.json' : resolve('/tmp/x.json')
    expect(resolveWorkspacePath(abs, '/some/workspace')).toBe(abs)
  })

  it('resolves a relative path against the workspace dir', () => {
    expect(resolveWorkspacePath('data.json', '/some/workspace')).toBe(resolve('/some/workspace', 'data.json'))
    expect(resolveWorkspacePath('sub/data.json', '/some/workspace')).toBe(resolve('/some/workspace', 'sub/data.json'))
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
