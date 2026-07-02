import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGit = {
  checkIsRepo: vi.fn(),
  status: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  fetch: vi.fn(),
  show: vi.fn(),
  merge: vi.fn(),
  raw: vi.fn()
}

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit)
}))

const mockWatcher = {
  on: vi.fn(),
  close: vi.fn()
}

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcher)
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('fs', () => ({ existsSync: vi.fn(() => true) }))
vi.mock('fs/promises', () => ({ writeFile: vi.fn() }))

import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { GitService } from './GitService'

function emptyStatus(overrides: Partial<{
  current: string | null
  ahead: number
  behind: number
  conflicted: string[]
  files: { path: string; index: string; working_dir: string }[]
}> = {}): {
  current: string | null
  ahead: number
  behind: number
  conflicted: string[]
  files: { path: string; index: string; working_dir: string }[]
} {
  return {
    current: 'main',
    ahead: 0,
    behind: 0,
    conflicted: [],
    files: [],
    ...overrides
  }
}

describe('GitService', () => {
  let service: GitService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(existsSync).mockReturnValue(true)
    mockGit.raw.mockResolvedValue('git version 2.43.0')
    service = new GitService()
  })

  afterEach(() => {
    service.dispose()
    vi.restoreAllMocks()
  })

  describe('isGitRepo', () => {
    it('returns true when the folder is inside a working tree', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      expect(await service.isGitRepo('/proj')).toBe(true)
    })

    it('returns false when git is not on PATH and fires the one-time cli-missing event', async () => {
      mockGit.raw.mockRejectedValue(new Error('ENOENT'))
      const onCliMissing = vi.fn()
      service.onCliMissing(onCliMissing)
      expect(await service.isGitRepo('/proj')).toBe(false)
      expect(await service.isGitRepo('/proj')).toBe(false)
      expect(onCliMissing).toHaveBeenCalledTimes(1)
      expect(service.getState().gitInstalled).toBe(false)
    })

    it('returns false when checkIsRepo rejects', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('not a repo'))
      expect(await service.isGitRepo('/proj')).toBe(false)
    })
  })

  describe('getStatus', () => {
    it('maps conflicted, added, deleted, renamed, untracked and modified files', async () => {
      mockGit.status.mockResolvedValue(emptyStatus({
        current: 'main',
        ahead: 1,
        behind: 2,
        conflicted: ['conflict.yaml'],
        files: [
          { path: 'conflict.yaml', index: 'U', working_dir: 'U' },
          { path: 'new.yaml', index: 'A', working_dir: ' ' },
          { path: 'gone.yaml', index: 'D', working_dir: ' ' },
          { path: 'moved.yaml', index: 'R', working_dir: ' ' },
          { path: 'unknown.yaml', index: '?', working_dir: '?' },
          { path: 'edited.yaml', index: 'M', working_dir: ' ' }
        ]
      }))

      const status = await service.getStatus('/proj')

      expect(status).toEqual({
        branch: 'main',
        ahead: 1,
        behind: 2,
        files: [
          { path: 'conflict.yaml', state: 'conflicted' },
          { path: 'new.yaml', state: 'added' },
          { path: 'gone.yaml', state: 'deleted' },
          { path: 'moved.yaml', state: 'renamed' },
          { path: 'unknown.yaml', state: 'untracked' },
          { path: 'edited.yaml', state: 'modified' }
        ]
      })
    })
  })

  describe('stage / commit / push', () => {
    it('stages the given paths', async () => {
      await service.stage('/proj', ['a.yaml', 'b.yaml'])
      expect(mockGit.add).toHaveBeenCalledWith(['a.yaml', 'b.yaml'])
    })

    it('commit returns the sha on success', async () => {
      mockGit.commit.mockResolvedValue({ commit: 'abc123' })
      expect(await service.commit('/proj', 'Update request X')).toEqual({ success: true, commit: 'abc123' })
    })

    it('commit reports failure without throwing', async () => {
      mockGit.commit.mockRejectedValue(new Error('nothing to commit'))
      const result = await service.commit('/proj', 'msg')
      expect(result.success).toBe(false)
      expect(result.error).toContain('nothing to commit')
    })

    it('push reports failure without throwing', async () => {
      mockGit.push.mockRejectedValue(new Error('rejected'))
      const result = await service.push('/proj')
      expect(result.success).toBe(false)
      expect(result.error).toContain('rejected')
    })
  })

  describe('pull', () => {
    it('succeeds cleanly with no conflicts', async () => {
      mockGit.pull.mockResolvedValue({})
      expect(await service.pull('/proj')).toEqual({ success: true, conflicted: false, conflictFiles: [] })
    })

    it('surfaces conflicted paths by re-reading status after the rejection', async () => {
      mockGit.pull.mockRejectedValue(new Error('merge conflict'))
      mockGit.status.mockResolvedValue(emptyStatus({ conflicted: ['a.yaml', 'b.yaml'] }))
      const result = await service.pull('/proj')
      expect(result).toEqual({ success: false, conflicted: true, conflictFiles: ['a.yaml', 'b.yaml'] })
    })

    it('reports a plain failure when the rejection is not a conflict', async () => {
      mockGit.pull.mockRejectedValue(new Error('network error'))
      mockGit.status.mockResolvedValue(emptyStatus())
      const result = await service.pull('/proj')
      expect(result).toMatchObject({ success: false, conflicted: false, conflictFiles: [] })
      expect(result.error).toContain('network error')
    })
  })

  describe('fetchAndCompare (semi-pull)', () => {
    it('reports a newer remote version when behind > 0', async () => {
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 3 }))
      expect(await service.fetchAndCompare('/proj')).toEqual({ remoteHasNewerVersion: true, behind: 3 })
      expect(mockGit.fetch).toHaveBeenCalled()
    })

    it('reports up to date when behind is 0', async () => {
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 0 }))
      expect(await service.fetchAndCompare('/proj')).toEqual({ remoteHasNewerVersion: false, behind: 0 })
    })
  })

  describe('getConflictVersions', () => {
    it('reads the three index stages, nulling out a missing one', async () => {
      mockGit.show.mockImplementation((args: string[]) => {
        const ref = args[0] ?? ''
        if (ref.startsWith(':1:')) throw new Error('no common ancestor')
        if (ref.startsWith(':2:')) return 'ours content'
        return 'theirs content'
      })
      const result = await service.getConflictVersions('/proj', 'requests/foo.yaml')
      expect(result).toEqual({ path: 'requests/foo.yaml', base: null, ours: 'ours content', theirs: 'theirs content' })
    })

    it('rejects a filePath that escapes the repo folder', async () => {
      await expect(service.getConflictVersions('/proj', '../../../../etc/cron.d/x')).rejects.toThrow('escapes the repo folder')
      expect(mockGit.show).not.toHaveBeenCalled()
    })
  })

  describe('writeResolvedConflict', () => {
    it('writes the resolved content to disk and stages it', async () => {
      await service.writeResolvedConflict('/proj', 'requests/foo.yaml', 'resolved: true')
      expect(vi.mocked(writeFile)).toHaveBeenCalledWith('/proj/requests/foo.yaml', 'resolved: true', 'utf-8')
      expect(mockGit.add).toHaveBeenCalledWith(['requests/foo.yaml'])
    })

    it('rejects a filePath that escapes the repo folder, writing nothing', async () => {
      await expect(service.writeResolvedConflict('/proj', '../../../../etc/cron.d/x', 'evil')).rejects.toThrow('escapes the repo folder')
      expect(vi.mocked(writeFile)).not.toHaveBeenCalled()
      expect(mockGit.add).not.toHaveBeenCalled()
    })

    it('rejects an absolute filePath override', async () => {
      await expect(service.writeResolvedConflict('/proj', '/etc/passwd', 'evil')).rejects.toThrow('escapes the repo folder')
      expect(vi.mocked(writeFile)).not.toHaveBeenCalled()
    })
  })

  describe('abortMerge', () => {
    it('runs merge --abort', async () => {
      await service.abortMerge('/proj')
      expect(mockGit.merge).toHaveBeenCalledWith(['--abort'])
    })
  })

  describe('setActiveFolder + watch', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('refreshes status and starts watching the .git dir when the folder is a repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus({ ahead: 1 }))

      await service.setActiveFolder('/proj')

      expect(service.getState()).toMatchObject({ isRepo: true, status: { branch: 'main', ahead: 1, behind: 0, files: [] } })
      expect(mockWatcher.on).toHaveBeenCalledWith('all', expect.any(Function))
    })

    it('does not watch when the folder is not a repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false)

      await service.setActiveFolder('/proj')

      expect(service.getState().isRepo).toBe(false)
      expect(mockWatcher.on).not.toHaveBeenCalled()
    })

    it('debounces a burst of watch events into a single refresh + semi-pull', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus())

      await service.setActiveFolder('/proj')
      const trigger = mockWatcher.on.mock.calls.find(([event]) => event === 'all')?.[1] as (() => void) | undefined
      expect(trigger).toBeDefined()

      mockGit.status.mockClear()
      mockGit.fetch.mockClear()
      trigger?.()
      trigger?.()
      trigger?.()
      await vi.advanceTimersByTimeAsync(500)

      expect(mockGit.fetch).toHaveBeenCalledTimes(1)
    })

    it('clears the active repo state and stops watching on a null folder', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus())
      await service.setActiveFolder('/proj')

      await service.setActiveFolder(null)

      expect(service.getState()).toMatchObject({ isRepo: false, status: null })
      expect(mockWatcher.close).toHaveBeenCalled()
    })
  })

  describe('reactive state', () => {
    it('broadcasts every state change to subscribers', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus())
      const listener = vi.fn()
      service.onStateChanged(listener)

      await service.setActiveFolder('/proj')

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isRepo: true }))
    })
  })
})
