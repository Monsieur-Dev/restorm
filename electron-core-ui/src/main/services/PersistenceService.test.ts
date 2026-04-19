import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs, existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (name: string) => `/tmp/${name}` }
}))
vi.mock('./LoggerService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { atomicWriteFile, filterNonSerialised, PersistenceService } from './PersistenceService'
import { NonSerialised, TreatEmptyAsUndefined } from '../decorators'

/**
 * Apply decorators programmatically — the project uses TC39 stage-3
 * decorators at runtime but TS legacy-shape factories, so `@` syntax
 * doesn't parse in test files. This mirrors what the legacy transform
 * would emit.
 */
function decorate(cls: object, propertyKey: string, factory: () => PropertyDecorator): void {
  factory()((cls as { prototype: object }).prototype, propertyKey)
}

class Doc {
  id = ''
  title = ''
  body: string | null | undefined = undefined
  transient = ''
}
decorate(Doc, 'transient', NonSerialised)
decorate(Doc, 'body', TreatEmptyAsUndefined)

describe('filterNonSerialised', () => {
  it('returns the input unchanged when no class is provided', () => {
    const input = { a: 1, b: 2 }
    expect(filterNonSerialised(input)).toBe(input)
  })

  it('drops @NonSerialised properties', () => {
    const out = filterNonSerialised({ id: 'x', title: 't', transient: 'gone' }, Doc)
    expect(out).toEqual({ id: 'x', title: 't' })
  })

  it('drops @TreatEmptyAsUndefined props when empty-string / null / undefined', () => {
    expect(filterNonSerialised({ id: 'x', body: '' }, Doc)).toEqual({ id: 'x' })
    expect(filterNonSerialised({ id: 'x', body: null }, Doc)).toEqual({ id: 'x' })
    expect(filterNonSerialised({ id: 'x', body: undefined }, Doc)).toEqual({ id: 'x' })
  })

  it('KEEPS @TreatEmptyAsUndefined props when the value is whitespace-only', () => {
    expect(filterNonSerialised({ body: '   ' }, Doc)).toEqual({ body: '   ' })
    expect(filterNonSerialised({ body: ' ' }, Doc)).toEqual({ body: ' ' })
  })

  it('KEEPS @TreatEmptyAsUndefined props when the value is non-empty', () => {
    expect(filterNonSerialised({ body: 'abc' }, Doc)).toEqual({ body: 'abc' })
    expect(filterNonSerialised({ body: '  abc  ' }, Doc)).toEqual({ body: '  abc  ' })
  })

  it('drops both @NonSerialised and empty @TreatEmptyAsUndefined in one pass', () => {
    const out = filterNonSerialised({ id: 'x', title: 't', body: '', transient: 'gone' }, Doc)
    expect(out).toEqual({ id: 'x', title: 't' })
  })
})

describe('atomicWriteFile', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'atomic-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('writes the contents to the target path', async () => {
    const target = join(dir, 'data.txt')
    await atomicWriteFile(target, 'hello')
    expect(await fs.readFile(target, 'utf-8')).toBe('hello')
  })

  it('creates the parent directory if needed', async () => {
    const target = join(dir, 'a', 'b', 'data.txt')
    await atomicWriteFile(target, 'hi')
    expect(existsSync(target)).toBe(true)
  })

  it('replaces an existing file atomically (no visible tmp left behind)', async () => {
    const target = join(dir, 'data.txt')
    writeFileSync(target, 'before', 'utf-8')
    await atomicWriteFile(target, 'after')
    expect(await fs.readFile(target, 'utf-8')).toBe('after')
    const entries = await fs.readdir(dir)
    expect(entries.some((n) => n.endsWith('.tmp'))).toBe(false)
  })

  it('leaves the previous file untouched when mkdir fails', async () => {
    const target = join(dir, 'data.txt')
    writeFileSync(target, 'kept', 'utf-8')
    // Writing to the file (rather than the dir) trips mkdir with EEXIST-but-not-a-directory
    // Simulate a mkdir failure by making the parent un-creatable: target dir is a file.
    const brokenParent = join(dir, 'parent-as-file')
    writeFileSync(brokenParent, 'am-a-file', 'utf-8')
    await expect(atomicWriteFile(join(brokenParent, 'nope.txt'), 'x')).rejects.toBeTruthy()
    // Original file preserved
    expect(await fs.readFile(target, 'utf-8')).toBe('kept')
  })
})

describe('PersistenceService.reindexFiles — reorder cascade', () => {
  let dir: string
  let svc: PersistenceService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reindex-'))
    svc = new PersistenceService({ format: 'yaml', extension: 'yaml', mode: 'folder', indexFileName: 'index' })
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('swaps two siblings without intermediate-state collisions', async () => {
    // Seed: two files with counters 1 and 2.
    writeFileSync(join(dir, '01 - Alpha.yaml'), 'id: a\nname: Alpha', 'utf-8')
    writeFileSync(join(dir, '02 - Beta.yaml'), 'id: b\nname: Beta', 'utf-8')

    // Reorder: Alpha at index 1 (counter 2), Beta at index 0 (counter 1).
    const items = [
      { id: 'b', name: 'Beta' },
      { id: 'a', name: 'Alpha' }
    ]
    const ok = await svc.reindexFiles(dir, items, {
      pattern: '{index} - {name}',
      nameProperty: 'name',
      idProperty: 'id'
    })
    expect(ok).toBe(true)

    const listing = readdirSync(dir).sort()
    expect(listing).toEqual(['01 - Beta.yaml', '02 - Alpha.yaml'])

    // No `__temp_*` files left behind
    expect(listing.some((n) => n.startsWith('__temp_'))).toBe(false)
  })

  it('keeps the original files when reindex is a no-op permutation', async () => {
    writeFileSync(join(dir, '01 - Alpha.yaml'), 'id: a\nname: Alpha', 'utf-8')
    writeFileSync(join(dir, '02 - Beta.yaml'), 'id: b\nname: Beta', 'utf-8')

    const items = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' }
    ]
    const ok = await svc.reindexFiles(dir, items, {
      pattern: '{index} - {name}',
      nameProperty: 'name',
      idProperty: 'id'
    })
    expect(ok).toBe(true)
    const listing = readdirSync(dir).sort()
    expect(listing).toEqual(['01 - Alpha.yaml', '02 - Beta.yaml'])
  })

  it('reindexes three siblings with no collision even when the middle stays put', async () => {
    writeFileSync(join(dir, '01 - A.yaml'), 'id: a\nname: A', 'utf-8')
    writeFileSync(join(dir, '02 - B.yaml'), 'id: b\nname: B', 'utf-8')
    writeFileSync(join(dir, '03 - C.yaml'), 'id: c\nname: C', 'utf-8')

    // Swap A and C, B stays at index 1.
    const items = [
      { id: 'c', name: 'C' },
      { id: 'b', name: 'B' },
      { id: 'a', name: 'A' }
    ]
    const ok = await svc.reindexFiles(dir, items, {
      pattern: '{index} - {name}',
      nameProperty: 'name',
      idProperty: 'id'
    })
    expect(ok).toBe(true)
    const listing = readdirSync(dir).sort()
    expect(listing).toEqual(['01 - C.yaml', '02 - B.yaml', '03 - A.yaml'])
  })
})
