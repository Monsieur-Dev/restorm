import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Minimal mocks so the FileService module loads — the draft code under
// test only needs the SaveUnitRegistry + DraftStore (real FS underneath).
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
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

function newHarness(): {
  service: FileService
  rootDir: string
  projectPath: string
  cleanup: () => void
} {
  const service = new FileService()
  const rootDir = mkdtempSync(join(tmpdir(), 'fs-drafts-root-'))
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
    projectUuid: 'test-proj',
    projectPath: ctx.projectPath,
    extension: 'json',
    serialize,
    deserialize,
    debounceMs
  })
}

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
    await fs.mkdir(join(ctx.rootDir, 'test-proj'), { recursive: true })
    await fs.writeFile(join(ctx.rootDir, 'test-proj', 'a.draft.json'), serialize({ n: 99 }), 'utf-8')
    await fs.writeFile(join(ctx.rootDir, 'test-proj', '.project-path'), ctx.projectPath, 'utf-8')

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
    await fs.writeFile(join(ctx.rootDir, 'test-proj', '.project-path'), ctx.projectPath, 'utf-8')

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
    await fs.writeFile(join(ctx.rootDir, 'test-proj', '.project-path'), ctx.projectPath, 'utf-8')

    const restored = await attach(ctx)
    expect(restored).toBe(1)
    const unit = ctx.service.getSaveUnitRegistry().get('orphan')
    expect(unit?.reference).toBeUndefined()
    expect(unit?.draft).toEqual({ n: 42 })
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

describe('FileService.saveUnit', () => {
  let ctx: ReturnType<typeof newHarness>
  beforeEach(() => { ctx = newHarness() })
  afterEach(() => { ctx.cleanup() })

  it('atomically writes the content and commits the unit', async () => {
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } })
    ctx.service.getSaveUnitRegistry().mutate('a', { name: 'v2' })
    expect(ctx.service.getSaveUnitRegistry().isDirty('a')).toBe(true)

    const target = join(ctx.projectPath, 'unit-a.json')
    const ok = await ctx.service.saveUnit({
      runtimeId: 'a',
      content: { name: 'v2' },
      absolutePath: target,
      format: 'json'
    })
    expect(ok).toBe(true)
    expect(JSON.parse(await fs.readFile(target, 'utf-8'))).toEqual({ name: 'v2' })

    // Unit is now clean, reference reflects the draft.
    const unit = ctx.service.getSaveUnitRegistry().get('a')
    expect(unit?.reference).toEqual({ name: 'v2' })
    expect(unit?.draft).toBeUndefined()
  })

  it('removes the draft file after a successful save', async () => {
    await attach(ctx)
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 2 })
    await new Promise((r) => setTimeout(r, 80))
    expect(existsSync(join(ctx.rootDir, 'test-proj', 'a.draft.json'))).toBe(true)

    await ctx.service.saveUnit({
      runtimeId: 'a',
      content: { n: 2 },
      absolutePath: join(ctx.projectPath, 'a.json'),
      format: 'json'
    })
    await new Promise((r) => setTimeout(r, 60))
    expect(existsSync(join(ctx.rootDir, 'test-proj', 'a.draft.json'))).toBe(false)
  })

  it('preserves a newer draft that arrived after the save snapshot was captured', async () => {
    await attach(ctx)
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { n: 1 } })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 2 })

    // Simulate a mutation landing between the caller's snapshot and the
    // persisted commit — the commit must skip so the newer draft survives.
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 3 })

    const target = join(ctx.projectPath, 'a.json')
    const ok = await ctx.service.saveUnit({
      runtimeId: 'a',
      content: { n: 2 },
      absolutePath: target,
      format: 'json'
    })
    expect(ok).toBe(true)
    // Disk reflects the snapshot we were told to save.
    expect(JSON.parse(await fs.readFile(target, 'utf-8'))).toEqual({ n: 2 })
    // Registry still dirty, draft advanced — ready for the next save cycle.
    const unit = ctx.service.getSaveUnitRegistry().get('a')
    expect(unit?.reference).toEqual({ n: 1 })
    expect(unit?.draft).toEqual({ n: 3 })
    expect(ctx.service.getSaveUnitRegistry().isDirty('a')).toBe(true)

    // Draft file still holds the newer value — we must not have deleted it.
    await new Promise((r) => setTimeout(r, 60))
    const draftPath = join(ctx.rootDir, 'test-proj', 'a.draft.json')
    expect(existsSync(draftPath)).toBe(true)
    expect(JSON.parse(await fs.readFile(draftPath, 'utf-8'))).toEqual({ n: 3 })
  })

  it('returns false when the write fails', async () => {
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'x' } })
    ctx.service.getSaveUnitRegistry().mutate('a', { name: 'y' })

    // Writing into a path that's blocked (parent exists as a file) triggers the error path.
    const brokenParent = join(ctx.projectPath, 'parent-as-file')
    await fs.writeFile(brokenParent, 'i am a file', 'utf-8')
    const ok = await ctx.service.saveUnit({
      runtimeId: 'a',
      content: { name: 'y' },
      absolutePath: join(brokenParent, 'nope.json'),
      format: 'json'
    })
    expect(ok).toBe(false)
    // Unit stays dirty so the user can retry.
    expect(ctx.service.getSaveUnitRegistry().isDirty('a')).toBe(true)
  })
})

describe('FileService.saveUnitsBatch', () => {
  let ctx: ReturnType<typeof newHarness>
  beforeEach(() => { ctx = newHarness() })
  afterEach(() => { ctx.cleanup() })

  it('saves every unit independently and returns per-unit outcomes', async () => {
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: {} })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 1 })
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'b', kind: 'file', reference: {} })
    ctx.service.getSaveUnitRegistry().mutate('b', { n: 2 })

    const outcomes = await ctx.service.saveUnitsBatch([
      { runtimeId: 'a', content: { n: 1 }, absolutePath: join(ctx.projectPath, 'a.json'), format: 'json' },
      { runtimeId: 'b', content: { n: 2 }, absolutePath: join(ctx.projectPath, 'b.json'), format: 'json' }
    ])

    expect(outcomes).toEqual([
      { runtimeId: 'a', success: true },
      { runtimeId: 'b', success: true }
    ])
    expect(ctx.service.getSaveUnitRegistry().isDirty('a')).toBe(false)
    expect(ctx.service.getSaveUnitRegistry().isDirty('b')).toBe(false)
  })

  it('a failing entry does not block the rest of the batch', async () => {
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'a', kind: 'file', reference: {} })
    ctx.service.getSaveUnitRegistry().mutate('a', { n: 1 })
    ctx.service.getSaveUnitRegistry().hydrate({ runtimeId: 'b', kind: 'file', reference: {} })
    ctx.service.getSaveUnitRegistry().mutate('b', { n: 2 })

    const brokenParent = join(ctx.projectPath, 'file-in-the-way')
    await fs.writeFile(brokenParent, 'x', 'utf-8')

    const outcomes = await ctx.service.saveUnitsBatch([
      { runtimeId: 'a', content: { n: 1 }, absolutePath: join(brokenParent, 'nope.json'), format: 'json' },
      { runtimeId: 'b', content: { n: 2 }, absolutePath: join(ctx.projectPath, 'b.json'), format: 'json' }
    ])

    expect(outcomes[0]?.success).toBe(false)
    expect(outcomes[1]?.success).toBe(true)
    expect(ctx.service.getSaveUnitRegistry().isDirty('a')).toBe(true)
    expect(ctx.service.getSaveUnitRegistry().isDirty('b')).toBe(false)
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

    // --- Save: the draft content is persisted, the unit goes clean,
    // the draft file disappears. ---
    const target = join(ctx.projectPath, 'req-1.json')
    const ok = await ctx.service.saveUnit({
      runtimeId: 'req-1',
      content: { name: 'v2' },
      absolutePath: target,
      format: 'json'
    })
    expect(ok).toBe(true)
    expect(JSON.parse(await fs.readFile(target, 'utf-8'))).toEqual({ name: 'v2' })
    await new Promise((r) => setTimeout(r, 60))
    expect(existsSync(draftPath)).toBe(false)
    const finalUnit = ctx.service.getSaveUnitRegistry().get('req-1')
    expect(finalUnit?.reference).toEqual({ name: 'v2' })
    expect(ctx.service.getSaveUnitRegistry().isDirty('req-1')).toBe(false)
  })

  it('orphaned drafts from a deleted project are swept at boot', async () => {
    // Stage a project directory with a draft + sidecar, then blow away
    // the pointed-to project on disk.
    const deletedProjectPath = mkdtempSync(join(tmpdir(), 'fs-gone-'))
    const draftDir = join(ctx.rootDir, 'uuid-of-deleted')
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(join(draftDir, 'x.draft.json'), serialize({ n: 1 }), 'utf-8')
    await fs.writeFile(join(draftDir, '.project-path'), deletedProjectPath, 'utf-8')
    rmSync(deletedProjectPath, { recursive: true, force: true })

    // A second, live project is untouched.
    const liveDir = join(ctx.rootDir, 'uuid-of-live')
    await fs.mkdir(liveDir, { recursive: true })
    await fs.writeFile(join(liveDir, 'y.draft.json'), serialize({ n: 2 }), 'utf-8')
    await fs.writeFile(join(liveDir, '.project-path'), ctx.projectPath, 'utf-8')

    const removed = await FileService.cleanupOrphanedDrafts(ctx.rootDir)
    expect(removed).toBe(1)
    expect(existsSync(draftDir)).toBe(false)
    expect(existsSync(liveDir)).toBe(true)
  })
})
