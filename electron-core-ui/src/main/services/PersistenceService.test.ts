import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: (name: string) => `/tmp/${name}` }
}))
vi.mock('./LoggerService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { atomicWriteFile, filterNonSerialised } from './PersistenceService'
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

  it('keeps a restrictive target mode across the write', async () => {
    // `rename` swaps the INODE, so the file inherits whatever mode the
    // umask gave the temp file unless the mode is carried over. A project
    // file kept at 600 can hold secrets; coming back as 644 is a silent
    // permission downgrade nobody asked for.
    const target = join(dir, 'secretish.txt')
    writeFileSync(target, 'before', 'utf-8')
    await fs.chmod(target, 0o600)

    await atomicWriteFile(target, 'after')

    expect(await fs.readFile(target, 'utf-8')).toBe('after')
    expect(((await fs.stat(target)).mode & 0o777)).toBe(0o600)
  })

  it('refuses to overwrite a file marked read-only', async () => {
    // `rename` consults only the DIRECTORY, so without the refusal the
    // read-only bit offers no resistance: the file is replaced and the
    // marking is gone. The user protected it on purpose.
    const target = join(dir, 'marked-read-only.txt')
    writeFileSync(target, 'protected', 'utf-8')
    await fs.chmod(target, 0o444)

    await expect(
      atomicWriteFile(target, 'overwritten', { refuseReadOnlyTarget: true })
    ).rejects.toMatchObject({
      code: 'FS_TARGET_READ_ONLY'
    })
    expect(await fs.readFile(target, 'utf-8')).toBe('protected')
    expect(((await fs.stat(target)).mode & 0o777)).toBe(0o444)
    expect((await fs.readdir(dir)).some((n) => n.endsWith('.tmp'))).toBe(false)
  })

  it('replaces a read-only file when the caller has not asked to refuse one', async () => {
    // The refusal is opt-in, and the default has to stay what it always
    // was: writers that recover by value, or that write several files in
    // one pass, would be left mid-operation by a throw they never handled.
    const target = join(dir, 'unguarded-read-only.txt')
    writeFileSync(target, 'protected', 'utf-8')
    await fs.chmod(target, 0o444)

    await atomicWriteFile(target, 'overwritten')

    expect(await fs.readFile(target, 'utf-8')).toBe('overwritten')
    // The mode is carried regardless — that half is never opt-in.
    expect(((await fs.stat(target)).mode & 0o777)).toBe(0o444)
  })

  it('writes a first file even though there is nothing to check the permissions of', async () => {
    // The refusal must not turn "no file yet" into a refusal of its own:
    // `access` fails with ENOENT there, which is not a read-only target.
    const target = join(dir, 'not-yet.txt')

    await atomicWriteFile(target, 'hello')

    expect(await fs.readFile(target, 'utf-8')).toBe('hello')
  })

  it('gives a brand-new file the umask default rather than inventing a mode', async () => {
    const target = join(dir, 'fresh.txt')

    await atomicWriteFile(target, 'hello')

    // Only that it is readable+writable by the owner — the exact bits are
    // the process umask's business, not this function's.
    expect(((await fs.stat(target)).mode & 0o600)).toBe(0o600)
  })

  it('propagates the write error when the pre-flight passed but the write failed anyway', async () => {
    // The pre-flight is a DETECTION, not the safety net: `access(W_OK)`
    // is advisory, lies under ACLs and reports writable for root. Here it
    // has nothing to object to — the file is writable, or absent — and
    // the DIRECTORY is what refuses. That errno must still reach the
    // caller, because this is the path the whole feature rests on.
    const locked = join(dir, 'locked')
    await fs.mkdir(locked)
    const target = join(locked, 'data.txt')
    writeFileSync(target, 'before', 'utf-8')
    await fs.chmod(target, 0o644)
    await fs.chmod(locked, 0o555)
    try {
      await expect(atomicWriteFile(target, 'x')).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await fs.chmod(locked, 0o755)
    }
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
