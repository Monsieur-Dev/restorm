import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Hoisted so the watcher describe below can point `getAllWindows` at a
// fake window without an unbound-method reference into the mocked class.
const { getAllWindowsMock } = vi.hoisted(() => ({ getAllWindowsMock: vi.fn<() => unknown[]>(() => []) }))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  BrowserWindow: { getAllWindows: getAllWindowsMock, getFocusedWindow: vi.fn(() => null) }
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
    service.close()
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

/**
 * The PROACTIVE half of the guard: a chokidar watcher armed on the open
 * file surfaces a third-party rewrite as soon as it lands, instead of
 * waiting for the app's next save attempt. Same digest logic, same
 * broadcast, same one-shot latch as the save-time path.
 */
describe('FileService — the open-file watcher (proactive detection)', () => {
  let dir: string
  let filePath: string
  let service: FileService
  let sent: [string, ...unknown[]][]

  const externallyChanged = (): [string, ...unknown[]][] => sent.filter(([ch]) => ch === 'file:externally-changed')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'restorm-extwatch-'))
    filePath = join(dir, 'project.json')
    writeFileSync(filePath, JSON.stringify({ name: 'ours' }), 'utf-8')
    sent = []
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, ...args: unknown[]) => { sent.push([channel, ...args]) } }
    }
    getAllWindowsMock.mockReturnValue([fakeWin])
    service = new FileService({ storagePrefix: 'test_', extension: '.json', externalWatchDebounceMs: 40 })
    await service.open(filePath)
    // chokidar arms asynchronously — give the inotify subscription a beat
    // so the external write below is guaranteed to be observed.
    await new Promise((r) => setTimeout(r, 150))
  })

  afterEach(() => {
    service.close()
    getAllWindowsMock.mockReturnValue([])
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('broadcasts file:externally-changed when a third party rewrites the file', async () => {
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')

    await vi.waitFor(() => { expect(externallyChanged().length).toBe(1) }, { timeout: 5000, interval: 25 })
    expect(externallyChanged()[0]?.[1]).toEqual({ path: filePath })
  })

  it('broadcasts ONCE for a burst of rewrites — the latch holds until resolved', async () => {
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')
    await vi.waitFor(() => { expect(externallyChanged().length).toBe(1) }, { timeout: 5000, interval: 25 })

    writeFileSync(filePath, JSON.stringify({ name: 'yet-another' }), 'utf-8')
    await new Promise((r) => setTimeout(r, 300))

    expect(externallyChanged().length).toBe(1)
  })

  it('stays silent for the app own save', async () => {
    expect(await service.save({ name: 'edited' })).toBe(true)

    await new Promise((r) => setTimeout(r, 400))
    expect(externallyChanged().length).toBe(0)
  })

  it('stays silent for the app own saveAs, and watches the NEW path', async () => {
    const newPath = join(dir, 'renamed.json')
    expect(await service.saveAs({ name: 'ours' }, newPath)).toBe(true)
    await new Promise((r) => setTimeout(r, 400))
    expect(externallyChanged().length).toBe(0)

    writeFileSync(newPath, JSON.stringify({ name: 'other' }), 'utf-8')
    await vi.waitFor(() => { expect(externallyChanged().length).toBe(1) }, { timeout: 5000, interval: 25 })
  })

  it('stops watching on close — no broadcast for a later rewrite', async () => {
    service.close()
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')

    await new Promise((r) => setTimeout(r, 300))
    expect(externallyChanged().length).toBe(0)
  })

  it('re-arms on reload: a SECOND external rewrite prompts again', async () => {
    writeFileSync(filePath, JSON.stringify({ name: 'other-branch' }), 'utf-8')
    await vi.waitFor(() => { expect(externallyChanged().length).toBe(1) }, { timeout: 5000, interval: 25 })

    // The reload path is a plain re-open of the same path.
    await service.open(filePath)
    await new Promise((r) => setTimeout(r, 150))
    writeFileSync(filePath, JSON.stringify({ name: 'third-branch' }), 'utf-8')

    await vi.waitFor(() => { expect(externallyChanged().length).toBe(2) }, { timeout: 5000, interval: 25 })
  })
})
