import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => null) }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('./StorageService', () => ({
  getStorageService: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), has: vi.fn(), delete: vi.fn() }))
}))

vi.mock('./I18nService', () => ({ i18nService: { t: vi.fn((k: string) => k) } }))

import { FileService } from './FileService'

/**
 * A `git checkout` / `git pull` run from a terminal rewrites the open
 * project file while the app still holds the OLD branch's tree in
 * memory. Autosave fires a second later, so without a guard the
 * checkout is silently undone on disk — the most destructive git
 * interaction the app has, and a completely silent one.
 */
describe('FileService — a file rewritten outside the app', () => {
  let dir: string
  let filePath: string
  let service: FileService

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'restorm-extchange-'))
    filePath = join(dir, 'project.json')
    writeFileSync(filePath, JSON.stringify({ name: 'ours' }), 'utf-8')
    service = new FileService({ storagePrefix: 'test_', extension: '.json' })
    await service.open(filePath)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('sees no external change when nobody touched the file', () => {
    expect(service.hasExternalChange()).toBe(false)
  })

  it('sees the rewrite once a third party changes the bytes', () => {
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')

    expect(service.hasExternalChange()).toBe(true)
  })

  it('refuses to overwrite the rewritten file, leaving the new content on disk', async () => {
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')

    const saved = await service.save({ name: 'stale-in-memory' })

    expect(saved).toBe(false)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'other-branch' })
  })

  it('overwrites when the user explicitly keeps their version', async () => {
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')

    const saved = await service.save({ name: 'mine' }, { force: true })

    expect(saved).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'mine' })
  })

  it('lets the ordinary save through once the user keeps their version', async () => {
    // What the renderer actually does on "keep mine": re-baseline, then
    // run its normal save-all — no force flag threaded through four
    // layers of save plumbing.
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')
    expect(await service.save({ name: 'mine' })).toBe(false)

    service.acceptExternalChange()

    expect(service.hasExternalChange()).toBe(false)
    expect(await service.save({ name: 'mine' })).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'mine' })
  })

  it('re-arms after a forced save, so the NEXT external rewrite is caught too', async () => {
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')
    await service.save({ name: 'mine' }, { force: true })

    expect(service.hasExternalChange()).toBe(false)

    writeFileSync(filePath, JSON.stringify({ name: 'third-branch' }), 'utf-8')

    expect(service.hasExternalChange()).toBe(true)
    expect(await service.save({ name: 'mine again' })).toBe(false)
  })

  it('does not treat its own save as an external change', async () => {
    expect(await service.save({ name: 'edited' })).toBe(true)

    expect(service.hasExternalChange()).toBe(false)
    expect(await service.save({ name: 'edited twice' })).toBe(true)
  })

  it('stays quiet after the file is closed', () => {
    service.close()
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')

    expect(service.hasExternalChange()).toBe(false)
  })
})
