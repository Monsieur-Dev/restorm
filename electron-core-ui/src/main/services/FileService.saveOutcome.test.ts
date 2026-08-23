import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const sent: { channel: string; payload: unknown }[] = []

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) } }
    }]),
    getFocusedWindow: vi.fn(() => null)
  }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('./StorageService', () => ({
  getStorageService: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), has: vi.fn(), delete: vi.fn() }))
}))

vi.mock('./I18nService', () => ({ i18nService: { t: vi.fn((k: string) => k) } }))

import { FileService } from './FileService'

function outcomes(): { channel: string; payload: unknown }[] {
  return sent.filter((e) => e.channel === 'file:save-failed' || e.channel === 'file:save-succeeded')
}

/**
 * A write that fails and says nothing is the defect this covers: the
 * dirty markers stay lit, which reads as "not saved yet", so the user
 * keeps working on a project they believe is on disk.
 */
describe('FileService — reporting the outcome of a write', () => {
  let dir: string
  let filePath: string
  let service: FileService

  beforeEach(async () => {
    sent.length = 0
    dir = mkdtempSync(join(tmpdir(), 'ecui-saveoutcome-'))
    filePath = join(dir, 'project.json')
    writeFileSync(filePath, JSON.stringify({ name: 'v1' }), 'utf-8')
    service = new FileService({ storagePrefix: 'test_', extension: '.json' })
    await service.open(filePath)
    sent.length = 0
  })

  afterEach(async () => {
    await fs.chmod(filePath, 0o644).catch(() => { /* already gone */ })
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('announces a save that landed', async () => {
    const saved = await service.save({ name: 'v2' })

    expect(saved).toBe(true)
    expect(outcomes()).toEqual([{ channel: 'file:save-succeeded', payload: { path: filePath } }])
  })

  it('announces a read-only file as such, not as a generic failure', async () => {
    await fs.chmod(filePath, 0o444)

    const saved = await service.save({ name: 'v2' })

    expect(saved).toBe(false)
    expect(outcomes()).toHaveLength(1)
    const [event] = outcomes()
    expect(event?.channel).toBe('file:save-failed')
    expect(event?.payload).toMatchObject({ path: filePath, reason: 'read-only-file' })
    // The file the user protected is still the file on disk, still marked.
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'v1' })
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o444)
  })

  it('names the directory as the cause when IT is what refuses the write', async () => {
    // A distinct cause AND a distinct code path: the file is writable, so
    // the pre-flight waves it through and the write itself fails. This is
    // the case the pre-flight cannot catch — and the one that must still
    // reach the user through the same channel.
    await fs.chmod(dir, 0o555)
    try {
      const saved = await service.save({ name: 'v2' })

      expect(saved).toBe(false)
      expect(outcomes()).toHaveLength(1)
      const [event] = outcomes()
      expect(event?.channel).toBe('file:save-failed')
      expect(event?.payload).toMatchObject({ path: filePath, reason: 'permission-denied' })
      expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'v1' })
    } finally {
      await fs.chmod(dir, 0o755)
    }
  })

  it('keeps a restrictive mode across a save that succeeds', async () => {
    // A project file can hold secrets; `rename` swaps the inode, so
    // without carrying the mode over it comes back at the umask default.
    await fs.chmod(filePath, 0o600)

    const saved = await service.save({ name: 'v2' })

    expect(saved).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'v2' })
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it('reports every failed attempt — deciding what to show is the renderer\'s job', async () => {
    // The autosave retries on a timer. Main stays a plain reporter: it is
    // the renderer that owns "one notice per failing streak", because
    // only it knows whether the user has already been told and closed it.
    await fs.chmod(filePath, 0o444)

    await service.save({ name: 'v2' })
    await service.save({ name: 'v3' })

    expect(outcomes()).toHaveLength(2)
    expect(outcomes().every((e) => e.channel === 'file:save-failed')).toBe(true)
  })

  it('announces the success that follows a failure, so the notice can be retracted', async () => {
    await fs.chmod(filePath, 0o444)
    await service.save({ name: 'v2' })
    await fs.chmod(filePath, 0o644)

    const saved = await service.save({ name: 'v3' })

    expect(saved).toBe(true)
    expect(outcomes().map((e) => e.channel)).toEqual(['file:save-failed', 'file:save-succeeded'])
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'v3' })
  })

  it('says nothing when the save is refused because the file changed outside the app', async () => {
    // That path has its own prompt (`file:externally-changed`); a second
    // notice on top of it would be noise, and the write never happened.
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')

    const saved = await service.save({ name: 'v2' })

    expect(saved).toBe(false)
    expect(outcomes()).toEqual([])
  })
})
