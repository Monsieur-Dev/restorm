import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// `getAllWindows` is hoisted out so tests can swap in a fake window and
// observe what FileService broadcasts to the renderer.
const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn((): unknown[] => [])
}))

// Minimal mocks so the FileService module loads — the draft code under
// test only needs the SaveUnitRegistry + DraftStore (real FS underneath).
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    getFocusedWindow: vi.fn(() => null)
  }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('./StorageService', () => ({
  getStorageService: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    delete: vi.fn()
  }))
}))

vi.mock('./EventBusService', () => ({
  eventBusService: { subscribe: vi.fn(), emit: vi.fn(), unsubscribe: vi.fn() }
}))

vi.mock('./I18nService', () => ({ i18nService: { t: vi.fn((k: string) => k) } }))

vi.mock('js-yaml', () => ({ default: { load: vi.fn(), dump: vi.fn() } }))

import { FileService } from './FileService'
import { makeTombstone } from './saveUnit'

const serialize = (v: unknown): string => JSON.stringify(v)
const deserialize = (raw: string): unknown => JSON.parse(raw) as unknown

/**
 * Stand in for the renderer so the `file:drafts-restored` broadcast —
 * the event the host app turns into the recovery toast — is observable.
 * Returns the channels sent, so a test can count how many toasts one
 * open would have produced.
 */
function captureBroadcasts(): { sent: string[] } {
  const sent: string[] = []
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel: string) => { sent.push(channel) } }
  }
  electronMocks.getAllWindows.mockReturnValue([fakeWindow])
  return { sent }
}

const draftsRestoredCount = (sent: string[]): number =>
  sent.filter((channel) => channel === 'file:drafts-restored').length

function newHarness(): {
  service: FileService
  rootDir: string
  projectPath: string
  cleanup: () => void
} {
  const service = new FileService()
  const rootDir = mkdtempSync(join(tmpdir(), 'fs-drafts-root-'))
  // The project directory is only used as a target location for
  // FileService.saveUnit(...) writes in the later tests — the draft
  // store itself no longer needs to know the project's path.
  const projectPath = mkdtempSync(join(tmpdir(), 'fs-drafts-project-'))
  return {
    service,
    rootDir,
    projectPath,
    cleanup: () => {
      rmSync(rootDir, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
    }
  }
}

async function attach(ctx: ReturnType<typeof newHarness>, debounceMs = 20): Promise<number> {
  return ctx.service.attachDraftStore({
    rootDir: ctx.rootDir,
    uuid: 'test-proj',
    extension: 'json',
    serialize,
    deserialize,
    debounceMs
  })
}

/** A second, unrelated project under the same drafts root. */
async function attachOther(ctx: ReturnType<typeof newHarness>): Promise<number> {
  return ctx.service.attachDraftStore({
    rootDir: ctx.rootDir,
    uuid: 'other-proj',
    extension: 'json',
    serialize,
    deserialize,
    debounceMs: 20
  })
}

// `captureBroadcasts` leaves a fake window in place; reset it for every
// test in the file so no suite inherits another's window list.
beforeEach(() => {
  electronMocks.getAllWindows.mockReturnValue([])
})

describe('FileService — draft store integration', () => {
  let ctx: ReturnType<typeof newHarness>

  beforeEach(() => { ctx = newHarness() })
  afterEach(() => { ctx.cleanup() })

  it('returns 0 when no drafts are present', async () => {
    expect(await attach(ctx)).toBe(0)
  })

  it('writes a draft file shortly after a unit becomes dirty', async () => {
    await attach(ctx)
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 2 })
    // Debounce is 20ms — wait a bit longer.
    await new Promise((r) => setTimeout(r, 80))
    const draftPath = join(ctx.rootDir, 'test-proj', 'a.draft.json')
    expect(existsSync(draftPath)).toBe(true)
    expect(JSON.parse(await fs.readFile(draftPath, 'utf-8'))).toEqual({ n: 2 })
  })

  it('removes the draft file when the unit is committed', async () => {
    await attach(ctx)
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 2 })
    await new Promise((r) => setTimeout(r, 80))
    const draftPath = join(ctx.rootDir, 'test-proj', 'a.draft.json')
    expect(existsSync(draftPath)).toBe(true)

    ctx.service.getSaveUnitRegistry().commit('a')
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(draftPath)).toBe(false)
  })

  it('removes the draft file when the unit is reverted', async () => {
    await attach(ctx)
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 2 })
    await new Promise((r) => setTimeout(r, 80))

    ctx.service.getSaveUnitRegistry().revert('a')
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(join(ctx.rootDir, 'test-proj', 'a.draft.json'))).toBe(false)
  })

  it('restores a regular draft on attach and marks the unit dirty', async () => {
    // Write a draft file directly without going through the service.
    // `attach` will stamp `.last-opened` itself via `markOpened`.
    await fs.mkdir(join(ctx.rootDir, 'test-proj'), { recursive: true })
    await fs.writeFile(join(ctx.rootDir, 'test-proj', 'a.draft.json'), serialize({ n: 99 }), 'utf-8')

    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    const restored = await attach(ctx)

    expect(restored).toBe(1)
    const unit = ctx.service.getSaveUnitRegistry().get('a')
    expect(unit?.draft).toEqual({ n: 99 })
  })

  it('restores a tombstone draft as a pending-delete', async () => {
    await fs.mkdir(join(ctx.rootDir, 'test-proj'), { recursive: true })
    await fs.writeFile(
      join(ctx.rootDir, 'test-proj', 'a.draft.json'),
      serialize(makeTombstone({ n: 1 })),
      'utf-8'
    )

    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    const restored = await attach(ctx)

    expect(restored).toBe(1)
    const unit = ctx.service.getSaveUnitRegistry().get('a')
    expect(unit?.draft).toBeDefined()
    expect((unit?.draft as { __tombstone?: boolean }).__tombstone).toBe(true)
  })

  it('restores a draft even when no matching reference exists (treats as create)', async () => {
    await fs.mkdir(join(ctx.rootDir, 'test-proj'), { recursive: true })
    await fs.writeFile(
      join(ctx.rootDir, 'test-proj', 'orphan.draft.json'),
      serialize({ n: 42 }),
      'utf-8'
    )

    const restored = await attach(ctx)
    expect(restored).toBe(1)
    const unit = ctx.service.getSaveUnitRegistry().get('orphan')
    expect(unit?.reference).toBeUndefined()
    expect(unit?.draft).toEqual({ n: 42 })
  })

  it('broadcasts drafts-restored once for a sequential repeat attach of the SAME project', async () => {
    // A host app routinely reaches `attachDraftStore` from two independent
    // callers for a single project open (a reactive state-change listener
    // and the explicit caller that awaited the open). Un-de-duplicated,
    // both re-read the drafts from disk and each broadcasts
    // `file:drafts-restored` — one open, two stacked recovery toasts.
    await fs.mkdir(join(ctx.rootDir, 'test-proj'), { recursive: true })
    await fs.writeFile(join(ctx.rootDir, 'test-proj', 'a.draft.json'), serialize({ n: 99 }), 'utf-8')
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    const { sent } = captureBroadcasts()

    const first = await attach(ctx)
    const second = await attach(ctx)

    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(draftsRestoredCount(sent)).toBe(1)
  })

  it('broadcasts drafts-restored once when both attaches of the SAME project are in flight together', async () => {
    // The real shape of the double-call: the reactive listener fires
    // synchronously inside the open, so its attach is still awaiting the
    // disk read when the awaited caller's attach arrives. The second
    // caller must join the first — and see the first's real count, not a
    // count from before the drafts were read.
    await fs.mkdir(join(ctx.rootDir, 'test-proj'), { recursive: true })
    await fs.writeFile(join(ctx.rootDir, 'test-proj', 'a.draft.json'), serialize({ n: 99 }), 'utf-8')
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    const { sent } = captureBroadcasts()

    const [first, second] = await Promise.all([attach(ctx), attach(ctx)])

    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(draftsRestoredCount(sent)).toBe(1)
  })

  it('re-attaching the SAME project after an explicit detach is a real re-attach, not suppressed', async () => {
    await fs.mkdir(join(ctx.rootDir, 'test-proj'), { recursive: true })
    await fs.writeFile(join(ctx.rootDir, 'test-proj', 'a.draft.json'), serialize({ n: 99 }), 'utf-8')
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })

    const first = await attach(ctx)
    expect(first).toBe(1)

    // A genuine close-then-reopen of the SAME project (e.g. the user
    // closes and reopens it later) must restore again — and announce it
    // again — not be swallowed by the de-duplication, which only covers
    // a repeat call within one open.
    ctx.service.detachDraftStore()
    const { sent } = captureBroadcasts()
    const second = await attach(ctx)

    expect(second).toBe(1)
    expect(draftsRestoredCount(sent)).toBe(1)
  })

  it('still reattaches and announces for a genuinely different project (different uuid)', async () => {
    const firstProjectRestored = await attach(ctx)
    expect(firstProjectRestored).toBe(0)

    await fs.mkdir(join(ctx.rootDir, 'other-proj'), { recursive: true })
    await fs.writeFile(join(ctx.rootDir, 'other-proj', 'b.draft.json'), serialize({ n: 5 }), 'utf-8')
    const { sent } = captureBroadcasts()
    const secondProjectRestored = await attachOther(ctx)

    expect(secondProjectRestored).toBe(1)
    expect(draftsRestoredCount(sent)).toBe(1)
    const unit = ctx.service.getSaveUnitRegistry().get('b')
    expect(unit?.draft).toEqual({ n: 5 })
  })

  it('abandons an attach that a project switch supersedes mid-flight', async () => {
    // The reactive caller is fire-and-forget, so its attach can still be
    // reading the disk when a switch to another project lands. The
    // superseded call must not finish into the NEW project's store —
    // that would restore its drafts a second time and re-announce them
    // behind the de-duplication's back.
    await fs.mkdir(join(ctx.rootDir, 'other-proj'), { recursive: true })
    await fs.writeFile(join(ctx.rootDir, 'other-proj', 'b.draft.json'), serialize({ n: 5 }), 'utf-8')
    const { sent } = captureBroadcasts()

    const superseded = attach(ctx)
    const winner = attachOther(ctx)

    expect(await superseded).toBe(0)
    expect(await winner).toBe(1)
    expect(draftsRestoredCount(sent)).toBe(1)
  })

  it('a failed attach is not cached — the next call for the same project retries', async () => {
    // `markOpened` has to create the project's draft directory; a plain
    // file sitting on that path makes it fail. The rejection must not
    // pin the identity, or every later attach for this project would
    // inherit the failure instead of restoring the drafts.
    const projectDir = join(ctx.rootDir, 'test-proj')
    await fs.writeFile(projectDir, 'not a directory', 'utf-8')

    await expect(attach(ctx)).rejects.toThrow()

    await fs.rm(projectDir)
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(join(projectDir, 'a.draft.json'), serialize({ n: 99 }), 'utf-8')
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })

    expect(await attach(ctx)).toBe(1)
  })

  it('detach stops writing drafts on subsequent changes', async () => {
    await attach(ctx)
    ctx.service.detachDraftStore()
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 2 })
    await new Promise((r) => setTimeout(r, 80))
    expect(existsSync(join(ctx.rootDir, 'test-proj', 'a.draft.json'))).toBe(false)
  })
})

describe('FileService.cleanupOrphanedDrafts', () => {
  it('delegates to sweepOrphanedDrafts', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'fs-sweep-'))
    try {
      expect(await FileService.cleanupOrphanedDrafts(rootDir)).toBe(0)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})

describe('FileService — full crash-and-recover loop', () => {
  let ctx: ReturnType<typeof newHarness>
  beforeEach(() => { ctx = newHarness() })
  afterEach(() => { ctx.cleanup() })

  it('preserves unsaved work across an attach → crash → re-attach cycle and cleans up after save', async () => {
    // --- Session 1: open project, mutate, let a draft land on disk. ---
    await attach(ctx)
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'req-1', kind: 'file', reference: { name: 'v1' } })
    ctx.service.getSaveUnitRegistry().mutate('req-1', { name: 'v2' })
    await new Promise((r) => setTimeout(r, 80))
    const draftPath = join(ctx.rootDir, 'test-proj', 'req-1.draft.json')
    expect(existsSync(draftPath)).toBe(true)

    // Simulate a crash: drop the in-memory registry. The draft on disk
    // is what keeps the user's work alive.
    ctx.service.detachDraftStore()
    ctx.service.getSaveUnitRegistry().clear()
    expect(ctx.service.getSaveUnitRegistry().get('req-1')).toBeUndefined()

    // --- Session 2: the host re-hydrates the known reference and
    // attaches the draft store again. The restored draft flips the
    // unit dirty with the user's in-progress edit. ---
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'req-1', kind: 'file', reference: { name: 'v1' } })
    const restored = await attach(ctx)
    expect(restored).toBe(1)
    const restoredUnit = ctx.service.getSaveUnitRegistry().get('req-1')
    expect(restoredUnit?.draft).toEqual({ name: 'v2' })
    expect(ctx.service.getSaveUnitRegistry().isDirty('req-1')).toBe(true)

    // --- Save: the host persists the whole file, then commits the unit
    // in the registry — the unit goes clean, the draft file disappears. ---
    ctx.service.getSaveUnitRegistry().commit('req-1')
    await new Promise((r) => setTimeout(r, 60))
    expect(existsSync(draftPath)).toBe(false)
    const finalUnit = ctx.service.getSaveUnitRegistry().get('req-1')
    expect(finalUnit?.reference).toEqual({ name: 'v2' })
    expect(ctx.service.getSaveUnitRegistry().isDirty('req-1')).toBe(false)
  })

  it('sweeps draft directories whose `.last-opened` marker is older than 30 days', async () => {
    // Stale project: last opened 60 days ago → beyond the default threshold.
    const staleDir = join(ctx.rootDir, 'uuid-of-stale')
    await fs.mkdir(staleDir, { recursive: true })
    await fs.writeFile(join(staleDir, 'x.draft.json'), serialize({ n: 1 }), 'utf-8')
    const staleTs = Date.now() - 60 * 24 * 60 * 60 * 1000
    await fs.writeFile(join(staleDir, '.last-opened'), String(staleTs), 'utf-8')

    // Fresh project: stamped today → kept regardless of where it lives on disk.
    const freshDir = join(ctx.rootDir, 'uuid-of-fresh')
    await fs.mkdir(freshDir, { recursive: true })
    await fs.writeFile(join(freshDir, 'y.draft.json'), serialize({ n: 2 }), 'utf-8')
    await fs.writeFile(join(freshDir, '.last-opened'), String(Date.now()), 'utf-8')

    const removed = await FileService.cleanupOrphanedDrafts(ctx.rootDir)
    expect(removed).toBe(1)
    expect(existsSync(staleDir)).toBe(false)
    expect(existsSync(freshDir)).toBe(true)
  })
})
