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

  describe('getConflictCommitTimestamps', () => {
    it('reads the HEAD and MERGE_HEAD commit timestamps', async () => {
      mockGit.show.mockImplementation((args: string[]) => {
        const ref = args[args.length - 1] ?? ''
        if (ref === 'HEAD') return Promise.resolve('1700000000\n')
        if (ref === 'MERGE_HEAD') return Promise.resolve('1700003600\n')
        return Promise.reject(new Error('unexpected ref'))
      })
      const result = await service.getConflictCommitTimestamps('/proj')
      expect(result).toEqual({ ours: 1700000000, theirs: 1700003600 })
    })

    it('resolves to null for a ref that cannot be read (e.g. MERGE_HEAD outside a merge)', async () => {
      mockGit.show.mockImplementation((args: string[]) => {
        const ref = args[args.length - 1] ?? ''
        if (ref === 'HEAD') return Promise.resolve('1700000000\n')
        return Promise.reject(new Error('unknown revision: MERGE_HEAD'))
      })
      const result = await service.getConflictCommitTimestamps('/proj')
      expect(result).toEqual({ ours: 1700000000, theirs: null })
    })
  })

  describe('getFileAtHead', () => {
    it('reads the file content at HEAD', async () => {
      mockGit.show.mockResolvedValue('collections:\n  - name: foo\n')
      const result = await service.getFileAtHead('/proj', 'api.restorm')
      expect(mockGit.show).toHaveBeenCalledWith(['HEAD:api.restorm'])
      expect(result).toBe('collections:\n  - name: foo\n')
    })

    it('resolves to null for a path that does not exist at HEAD (never committed)', async () => {
      mockGit.show.mockRejectedValue(new Error('path does not exist in HEAD'))
      const result = await service.getFileAtHead('/proj', 'api.restorm')
      expect(result).toBeNull()
    })

    it('rejects a filePath that escapes the repo folder', async () => {
      await expect(service.getFileAtHead('/proj', '../../../../etc/cron.d/x')).rejects.toThrow('escapes the repo folder')
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

    it('check-on-open: runs a semi-pull immediately when opening a repo folder that already has a newer remote version', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 3 }))

      await service.setActiveFolder('/proj')

      expect(mockGit.fetch).toHaveBeenCalledTimes(1)
      expect(service.getState().remoteHasNewerVersion).toBe(true)
    })

    it('check-on-open: does not run a semi-pull when the folder is not a repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false)

      await service.setActiveFolder('/proj')

      expect(mockGit.fetch).not.toHaveBeenCalled()
    })
  })

  describe('checkForRemoteUpdate (AC#1/#3/#4 shared implementation)', () => {
    it('is a no-op with no active folder', async () => {
      await service.checkForRemoteUpdate()
      expect(mockGit.fetch).not.toHaveBeenCalled()
    })

    it('is a no-op when the active folder is not a repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false)
      await service.setActiveFolder('/proj')
      mockGit.fetch.mockClear()

      await service.checkForRemoteUpdate()

      expect(mockGit.fetch).not.toHaveBeenCalled()
    })

    it('fires onPullAvailable only on the false→true edge, never on a repeat true→true check', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 0 }))
      await service.setActiveFolder('/proj')

      const onPullAvailable = vi.fn()
      service.onPullAvailable(onPullAvailable)

      mockGit.status.mockResolvedValue(emptyStatus({ behind: 2 }))
      await service.checkForRemoteUpdate()
      expect(onPullAvailable).toHaveBeenCalledTimes(1)

      // Still behind — a repeat check (e.g. the next CRON tick) must not
      // re-fire the toast for the same still-unpulled remote commit.
      await service.checkForRemoteUpdate()
      expect(onPullAvailable).toHaveBeenCalledTimes(1)
    })

    it('does not fire onPullAvailable on the true→false edge (after the user pulls)', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 2 }))
      await service.setActiveFolder('/proj')
      expect(service.getState().remoteHasNewerVersion).toBe(true)

      const onPullAvailable = vi.fn()
      service.onPullAvailable(onPullAvailable)

      mockGit.status.mockResolvedValue(emptyStatus({ behind: 0 }))
      await service.checkForRemoteUpdate()

      expect(service.getState().remoteHasNewerVersion).toBe(false)
      expect(onPullAvailable).not.toHaveBeenCalled()
    })

    it('can re-fire onPullAvailable on a LATER false→true edge (pull, then a new remote commit)', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true)
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 0 }))
      await service.setActiveFolder('/proj')

      const onPullAvailable = vi.fn()
      service.onPullAvailable(onPullAvailable)

      mockGit.status.mockResolvedValue(emptyStatus({ behind: 1 }))
      await service.checkForRemoteUpdate()
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 0 }))
      await service.checkForRemoteUpdate()
      mockGit.status.mockResolvedValue(emptyStatus({ behind: 4 }))
      await service.checkForRemoteUpdate()

      expect(onPullAvailable).toHaveBeenCalledTimes(2)
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
