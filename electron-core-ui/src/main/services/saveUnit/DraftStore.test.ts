import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DraftStore, sweepOrphanedDrafts, DEFAULT_DRAFT_DEBOUNCE_MS, DEFAULT_DRAFT_MAX_AGE_DAYS } from './DraftStore'
import { makeTombstone } from './types'

const noopSerialize = (value: unknown): string => JSON.stringify(value)
const noopDeserialize = (raw: string): unknown => JSON.parse(raw) as unknown

function makeStore(overrides?: Partial<{ debounceMs: number }>): {
  store: DraftStore
  rootDir: string
  projectDir: string
  cleanup: () => void
} {
  const rootDir = mkdtempSync(join(tmpdir(), 'draftstore-'))
  const store = new DraftStore({
    rootDir,
    uuid: 'project-uuid-a',
    extension: 'json',
    serialize: noopSerialize,
    deserialize: noopDeserialize,
    debounceMs: overrides?.debounceMs ?? 20
  })
  return {
    store,
    rootDir,
    projectDir: join(rootDir, 'project-uuid-a'),
    cleanup: () => {
      rmSync(rootDir, { recursive: true, force: true })
    }
  }
}

describe('DraftStore.writeDraft', () => {
  let ctx: ReturnType<typeof makeStore>
  beforeEach(() => { ctx = makeStore() })
  afterEach(() => { ctx.cleanup() })

  it('writes a draft file after the debounce window', async () => {
    await ctx.store.writeDraft('r1', { name: 'first' })
    const path = ctx.store.getDraftPath('r1')
    expect(existsSync(path)).toBe(true)
    const content = await fs.readFile(path, 'utf-8')
    expect(JSON.parse(content)).toEqual({ name: 'first' })
  })

  it('coalesces rapid writes — only the last value lands on disk', async () => {
    const first = ctx.store.writeDraft('r1', { v: 1 })
    const second = ctx.store.writeDraft('r1', { v: 2 })
    const third = ctx.store.writeDraft('r1', { v: 3 })
    // All three promises share fate.
    expect(first).toBe(second)
    expect(second).toBe(third)
    await third
    const content = JSON.parse(await fs.readFile(ctx.store.getDraftPath('r1'), 'utf-8')) as { v: number }
    expect(content.v).toBe(3)
  })

  it('writes atomically — no *.tmp files remain after a successful flush', async () => {
    await ctx.store.writeDraft('r1', { v: 1 })
    const entries = await fs.readdir(ctx.projectDir)
    expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('uses a `<runtimeId>.draft.<ext>` filename', async () => {
    await ctx.store.writeDraft('abc123', { v: 1 })
    expect(existsSync(join(ctx.projectDir, 'abc123.draft.json'))).toBe(true)
  })

  it('persists tombstones as-is', async () => {
    await ctx.store.writeDraft('r1', makeTombstone({ name: 'removed' }))
    const content = JSON.parse(await fs.readFile(ctx.store.getDraftPath('r1'), 'utf-8')) as {
      __tombstone: boolean
      snapshot: { name: string }
    }
    expect(content.__tombstone).toBe(true)
    expect(content.snapshot).toEqual({ name: 'removed' })
  })
})

describe('DraftStore.markOpened', () => {
  let ctx: ReturnType<typeof makeStore>
  beforeEach(() => { ctx = makeStore() })
  afterEach(() => { ctx.cleanup() })

  it('creates the project dir and stamps a numeric `.last-opened` timestamp', async () => {
    const before = Date.now()
    await ctx.store.markOpened()
    const after = Date.now()
    const marker = (await fs.readFile(join(ctx.projectDir, '.last-opened'), 'utf-8')).trim()
    const stamped = Number.parseInt(marker, 10)
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(after)
  })

  it('refreshes the timestamp on repeated calls', async () => {
    await ctx.store.markOpened()
    const first = Number.parseInt((await fs.readFile(join(ctx.projectDir, '.last-opened'), 'utf-8')).trim(), 10)
    // Sleep to guarantee a new timestamp even on coarse clocks.
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    await ctx.store.markOpened()
    const second = Number.parseInt((await fs.readFile(join(ctx.projectDir, '.last-opened'), 'utf-8')).trim(), 10)
    expect(second).toBeGreaterThanOrEqual(first)
  })
})

describe('DraftStore.deleteDraft', () => {
  let ctx: ReturnType<typeof makeStore>
  beforeEach(() => { ctx = makeStore() })
  afterEach(() => { ctx.cleanup() })

  it('removes an existing draft file', async () => {
    await ctx.store.writeDraft('r1', { v: 1 })
    await ctx.store.deleteDraft('r1')
    expect(existsSync(ctx.store.getDraftPath('r1'))).toBe(false)
  })

  it('is a no-op for a non-existent draft', async () => {
    await expect(ctx.store.deleteDraft('missing')).resolves.toBeUndefined()
  })

  it('cancels a pending debounced write', async () => {
    // Use a long debounce so we have a window to cancel inside.
    ctx.cleanup()
    ctx = makeStore({ debounceMs: 200 })
    const p = ctx.store.writeDraft('r1', { v: 1 })
    await ctx.store.deleteDraft('r1')
    // The cancelled write resolves (doesn't reject) and no file is written.
    await p
    expect(existsSync(ctx.store.getDraftPath('r1'))).toBe(false)
  })
})

describe('DraftStore.clearAllDrafts', () => {
  let ctx: ReturnType<typeof makeStore>
  beforeEach(() => { ctx = makeStore() })
  afterEach(() => { ctx.cleanup() })

  it('removes every `.draft.<ext>` file in the project directory', async () => {
    await ctx.store.writeDraft('r1', { v: 1 })
    await ctx.store.writeDraft('r2', { v: 2 })
    await ctx.store.writeDraft('r3', { v: 3 })
    expect(existsSync(ctx.store.getDraftPath('r1'))).toBe(true)
    expect(existsSync(ctx.store.getDraftPath('r2'))).toBe(true)
    expect(existsSync(ctx.store.getDraftPath('r3'))).toBe(true)

    await ctx.store.clearAllDrafts()

    expect(existsSync(ctx.store.getDraftPath('r1'))).toBe(false)
    expect(existsSync(ctx.store.getDraftPath('r2'))).toBe(false)
    expect(existsSync(ctx.store.getDraftPath('r3'))).toBe(false)
    const drafts = await ctx.store.loadAllDrafts()
    expect(drafts).toEqual([])
  })

  it('preserves the `.last-opened` marker so the age-based sweep keeps the project alive', async () => {
    await ctx.store.markOpened()
    await ctx.store.writeDraft('r1', { v: 1 })
    const markerBefore = join(ctx.projectDir, '.last-opened')
    expect(existsSync(markerBefore)).toBe(true)

    await ctx.store.clearAllDrafts()

    expect(existsSync(markerBefore)).toBe(true)
  })

  it('cancels every pending debounced write so a flush cannot recreate a cleared file', async () => {
    ctx.cleanup()
    ctx = makeStore({ debounceMs: 200 })
    const p1 = ctx.store.writeDraft('r1', { v: 1 })
    const p2 = ctx.store.writeDraft('r2', { v: 2 })

    await ctx.store.clearAllDrafts()
    await Promise.all([p1, p2])
    // Wait past the debounce window — if the cancel didn't take, a
    // pending timer would re-create the file here.
    await new Promise((r) => setTimeout(r, 250))

    expect(existsSync(ctx.store.getDraftPath('r1'))).toBe(false)
    expect(existsSync(ctx.store.getDraftPath('r2'))).toBe(false)
  })

  it('removes orphan drafts whose runtime id no longer corresponds to any tracked unit', async () => {
    // Stale-orphan scenario: a previous session left a draft on
    // disk for a unit that has since been deleted from the
    // in-memory tree. The current session has no record of it, so
    // per-unit `deleteDraft` would never fire — but
    // `clearAllDrafts` reaps it.
    await ctx.store.writeDraft('orphan', { stale: true })
    expect(existsSync(ctx.store.getDraftPath('orphan'))).toBe(true)

    await ctx.store.clearAllDrafts()

    expect(existsSync(ctx.store.getDraftPath('orphan'))).toBe(false)
  })

  it('is a no-op when the project directory does not exist', async () => {
    await expect(ctx.store.clearAllDrafts()).resolves.toBeUndefined()
  })

  it('drains in-flight flushes mid-write so a parallel flush cannot recreate a cleared file', async () => {
    // Repro of the in-flight flush race: many writes with a tiny
    // debounce → some `setTimeout` callbacks have already fired and
    // their `runFlush` bodies are parked on async I/O when the host
    // calls `clearAllDrafts`. The bulk-clear must (a) toggle
    // `discardingDrafts` so flushes that haven't reached
    // `atomicWrite` bail, and (b) await every in-flight promise
    // before walking the directory so a flush that's mid-write
    // settles before the unlink pass. End-state must be: zero
    // `.draft.*` files on disk, regardless of timing.
    ctx.cleanup()
    const rootDir = mkdtempSync(join(tmpdir(), 'draftstore-race-'))
    const store = new DraftStore({
      rootDir,
      uuid: 'project-uuid-race',
      extension: 'json',
      serialize: noopSerialize,
      deserialize: noopDeserialize,
      debounceMs: 1
    })

    // Schedule 50 writes with a 1ms debounce, immediately race
    // `clearAllDrafts` against them. Without the in-flight drain,
    // flushes that fire AFTER `readdir` would land orphan files.
    const writes = Array.from({ length: 50 }, (_, i) => store.writeDraft(`r${String(i)}`, { v: i }))
    await store.clearAllDrafts()
    await Promise.all(writes)

    const projectDir = join(rootDir, 'project-uuid-race')
    if (existsSync(projectDir)) {
      const left = (await fs.readdir(projectDir)).filter((name) => name.endsWith('.draft.json'))
      expect(left).toEqual([])
    }
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('also unlinks `*.tmp` sidecars from interrupted atomic writes', async () => {
    await fs.mkdir(ctx.projectDir, { recursive: true })
    const tmpPath = join(ctx.projectDir, 'r1.draft.json.abc-tmp.tmp')
    await fs.writeFile(tmpPath, 'partial', 'utf-8')
    expect(existsSync(tmpPath)).toBe(true)

    await ctx.store.clearAllDrafts()

    expect(existsSync(tmpPath)).toBe(false)
  })
})

describe('DraftStore.loadAllDrafts', () => {
  let ctx: ReturnType<typeof makeStore>
  beforeEach(() => { ctx = makeStore() })
  afterEach(() => { ctx.cleanup() })

  it('returns an empty array when the project dir does not exist', async () => {
    expect(await ctx.store.loadAllDrafts()).toEqual([])
  })

  it('loads every draft, parses the payload, and exposes the runtimeId', async () => {
    await ctx.store.writeDraft('r1', { v: 1 })
    await ctx.store.writeDraft('r2', makeTombstone({ v: 99 }))
    const loaded = await ctx.store.loadAllDrafts()
    const byId = new Map(loaded.map((l) => [l.runtimeId, l.payload]))
    expect(byId.get('r1')).toEqual({ v: 1 })
    const tombstone = byId.get('r2') as { __tombstone: boolean; snapshot: { v: number } }
    expect(tombstone.__tombstone).toBe(true)
    expect(tombstone.snapshot.v).toBe(99)
  })

  it('ignores non-draft files in the directory', async () => {
    await ctx.store.writeDraft('r1', { v: 1 })
    await fs.writeFile(join(ctx.projectDir, 'unrelated.txt'), 'foo', 'utf-8')
    const loaded = await ctx.store.loadAllDrafts()
    expect(loaded.map((l) => l.runtimeId)).toEqual(['r1'])
  })
})

describe('sweepOrphanedDrafts (age-based)', () => {
  let rootDir: string
  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'draftsweep-'))
  })
  afterEach(() => { rmSync(rootDir, { recursive: true, force: true }) })

  it('removes directories whose `.last-opened` marker is older than maxAgeDays', async () => {
    const staleDir = join(rootDir, 'uuid-stale')
    await fs.mkdir(staleDir, { recursive: true })
    // 60 days ago — beyond the default 30-day threshold.
    const staleTs = Date.now() - 60 * 24 * 60 * 60 * 1000
    await fs.writeFile(join(staleDir, '.last-opened'), String(staleTs), 'utf-8')

    const freshDir = join(rootDir, 'uuid-fresh')
    await fs.mkdir(freshDir, { recursive: true })
    await fs.writeFile(join(freshDir, '.last-opened'), String(Date.now()), 'utf-8')

    const removed = await sweepOrphanedDrafts(rootDir)
    expect(removed).toBe(1)
    expect(existsSync(staleDir)).toBe(false)
    expect(existsSync(freshDir)).toBe(true)
  })

  it('removes directories that have no marker (abandoned from older builds)', async () => {
    const ancient = join(rootDir, 'uuid-ancient')
    await fs.mkdir(ancient, { recursive: true })
    await fs.writeFile(join(ancient, 'random.draft.json'), '{}', 'utf-8')
    const removed = await sweepOrphanedDrafts(rootDir)
    expect(removed).toBe(1)
    expect(existsSync(ancient)).toBe(false)
  })

  it('respects a custom maxAgeDays override', async () => {
    const dir = join(rootDir, 'uuid-one-day-old')
    await fs.mkdir(dir, { recursive: true })
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    await fs.writeFile(join(dir, '.last-opened'), String(oneDayAgo), 'utf-8')

    // Default 30-day threshold → keep.
    expect(await sweepOrphanedDrafts(rootDir)).toBe(0)
    expect(existsSync(dir)).toBe(true)

    // Tighter threshold → reap.
    expect(await sweepOrphanedDrafts(rootDir, 0)).toBe(1)
    expect(existsSync(dir)).toBe(false)
  })

  it('keeps directories whose `.last-opened` marker was refreshed recently by `markOpened`', async () => {
    // Simulate an "opened long ago, then reopened today" flow: seed
    // an old timestamp, then instantiate a store pointing at the same
    // UUID and call `markOpened`. The refreshed marker must survive
    // the default sweep.
    const uuid = 'uuid-refreshed'
    const dir = join(rootDir, uuid)
    await fs.mkdir(dir, { recursive: true })
    const ancient = Date.now() - 90 * 24 * 60 * 60 * 1000
    await fs.writeFile(join(dir, '.last-opened'), String(ancient), 'utf-8')

    const store = new DraftStore({
      rootDir,
      uuid,
      extension: 'json',
      serialize: noopSerialize,
      deserialize: noopDeserialize,
      debounceMs: 5
    })
    await store.markOpened()

    const removed = await sweepOrphanedDrafts(rootDir)
    expect(removed).toBe(0)
    expect(existsSync(dir)).toBe(true)
  })

  it('returns 0 when the root dir does not exist', async () => {
    const missing = join(rootDir, 'not-there-at-all')
    expect(await sweepOrphanedDrafts(missing)).toBe(0)
  })
})

describe('DEFAULT_DRAFT_DEBOUNCE_MS', () => {
  it('is 300 ms per the OYO-183 spec', () => {
    expect(DEFAULT_DRAFT_DEBOUNCE_MS).toBe(300)
  })
})

describe('DEFAULT_DRAFT_MAX_AGE_DAYS', () => {
  it('defaults to 30 days', () => {
    expect(DEFAULT_DRAFT_MAX_AGE_DAYS).toBe(30)
  })
})
