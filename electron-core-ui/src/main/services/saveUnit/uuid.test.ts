import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureFolderUuid, readFolderUuid, ensureFileUuid, DEFAULT_UUID_KEY } from './uuid'
import { serialize, deserialize } from '../PersistenceService'

let projectPath: string

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'folder-uuid-'))
})

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true })
})

describe('ensureFolderUuid', () => {
  it('generates and writes a UUID when the root index file does not exist', async () => {
    const result = await ensureFolderUuid({ projectPath, format: 'json', extension: 'json' })

    expect(result.generated).toBe(true)
    expect(result.uuid).toMatch(/.+/)

    const indexPath = join(projectPath, 'index.json')
    expect(existsSync(indexPath)).toBe(true)
    const parsed = deserialize(await fs.readFile(indexPath, 'utf-8'), 'json') as Record<string, unknown>
    expect(parsed[DEFAULT_UUID_KEY]).toBe(result.uuid)
  })

  it('returns the existing UUID without rewriting when already present', async () => {
    const indexPath = join(projectPath, 'index.json')
    const existing = { [DEFAULT_UUID_KEY]: 'fixed-uuid-123', name: 'Demo', items: [1, 2, 3] }
    await fs.writeFile(indexPath, serialize(existing, 'json'), 'utf-8')
    const mtimeBefore = (await fs.stat(indexPath)).mtimeMs

    await new Promise((r) => setTimeout(r, 10))
    const result = await ensureFolderUuid({ projectPath, format: 'json', extension: 'json' })

    expect(result.generated).toBe(false)
    expect(result.uuid).toBe('fixed-uuid-123')
    const mtimeAfter = (await fs.stat(indexPath)).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
  })

  it('generates a UUID and preserves other fields when file lacks the key', async () => {
    const indexPath = join(projectPath, 'index.json')
    const existing = { name: 'Demo', items: [1, 2, 3] }
    await fs.writeFile(indexPath, serialize(existing, 'json'), 'utf-8')

    const result = await ensureFolderUuid({ projectPath, format: 'json', extension: 'json' })

    expect(result.generated).toBe(true)
    const parsed = deserialize(await fs.readFile(indexPath, 'utf-8'), 'json') as Record<string, unknown>
    expect(parsed[DEFAULT_UUID_KEY]).toBe(result.uuid)
    expect(parsed['name']).toBe('Demo')
    expect(parsed['items']).toEqual([1, 2, 3])
  })

  it('regenerates when the stored UUID is empty', async () => {
    const indexPath = join(projectPath, 'index.json')
    await fs.writeFile(indexPath, serialize({ [DEFAULT_UUID_KEY]: '' }, 'json'), 'utf-8')

    const result = await ensureFolderUuid({ projectPath, format: 'json', extension: 'json' })

    expect(result.generated).toBe(true)
    expect(result.uuid.length).toBeGreaterThan(0)
  })

  it('honors a custom indexFileName', async () => {
    const result = await ensureFolderUuid({
      projectPath,
      format: 'json',
      extension: 'json',
      indexFileName: '_index'
    })

    expect(result.generated).toBe(true)
    expect(existsSync(join(projectPath, '_index.json'))).toBe(true)
    expect(existsSync(join(projectPath, 'index.json'))).toBe(false)
  })

  it('supports yaml format', async () => {
    const result = await ensureFolderUuid({ projectPath, format: 'yaml', extension: 'yaml' })

    expect(result.generated).toBe(true)
    const indexPath = join(projectPath, 'index.yaml')
    expect(existsSync(indexPath)).toBe(true)
    const parsed = deserialize(await fs.readFile(indexPath, 'utf-8'), 'yaml') as Record<string, unknown>
    expect(parsed[DEFAULT_UUID_KEY]).toBe(result.uuid)
  })

  it('is idempotent across repeated calls', async () => {
    const first = await ensureFolderUuid({ projectPath, format: 'json', extension: 'json' })
    const second = await ensureFolderUuid({ projectPath, format: 'json', extension: 'json' })
    const third = await ensureFolderUuid({ projectPath, format: 'json', extension: 'json' })

    expect(first.uuid).toBe(second.uuid)
    expect(second.uuid).toBe(third.uuid)
    expect(first.generated).toBe(true)
    expect(second.generated).toBe(false)
    expect(third.generated).toBe(false)
  })

  it('honors a custom uuidKey for both read and write', async () => {
    const customKey = '_myAppUuid'
    const first = await ensureFolderUuid({
      projectPath,
      format: 'json',
      extension: 'json',
      uuidKey: customKey
    })
    expect(first.generated).toBe(true)

    const parsed = deserialize(
      await fs.readFile(join(projectPath, 'index.json'), 'utf-8'),
      'json'
    ) as Record<string, unknown>
    expect(parsed[customKey]).toBe(first.uuid)
    expect(parsed[DEFAULT_UUID_KEY]).toBeUndefined()

    // A second call with the same custom key finds the existing UUID.
    const second = await ensureFolderUuid({
      projectPath,
      format: 'json',
      extension: 'json',
      uuidKey: customKey
    })
    expect(second.generated).toBe(false)
    expect(second.uuid).toBe(first.uuid)
  })
})

describe('readFolderUuid', () => {
  it('returns undefined when the index file does not exist', async () => {
    const result = await readFolderUuid({ projectPath, format: 'json', extension: 'json' })
    expect(result).toBeUndefined()
  })

  it('returns the stored UUID when present', async () => {
    const indexPath = join(projectPath, 'index.json')
    await fs.writeFile(indexPath, serialize({ [DEFAULT_UUID_KEY]: 'stored-uuid' }, 'json'), 'utf-8')

    const result = await readFolderUuid({ projectPath, format: 'json', extension: 'json' })
    expect(result).toBe('stored-uuid')
  })

  it('returns the stored UUID under a custom key', async () => {
    const customKey = '_myAppUuid'
    const indexPath = join(projectPath, 'index.json')
    await fs.writeFile(indexPath, serialize({ [customKey]: 'stored-uuid' }, 'json'), 'utf-8')

    const result = await readFolderUuid({ projectPath, format: 'json', extension: 'json', uuidKey: customKey })
    expect(result).toBe('stored-uuid')
  })

  it('returns undefined when the file has no UUID field', async () => {
    const indexPath = join(projectPath, 'index.json')
    await fs.writeFile(indexPath, serialize({ name: 'Demo' }, 'json'), 'utf-8')

    const result = await readFolderUuid({ projectPath, format: 'json', extension: 'json' })
    expect(result).toBeUndefined()
  })

  it('returns undefined when the file is malformed', async () => {
    const indexPath = join(projectPath, 'index.json')
    await fs.writeFile(indexPath, '{not valid json', 'utf-8')

    const result = await readFolderUuid({ projectPath, format: 'json', extension: 'json' })
    expect(result).toBeUndefined()
  })

  it('returns undefined when the file stores a non-string UUID', async () => {
    const indexPath = join(projectPath, 'index.json')
    await fs.writeFile(indexPath, serialize({ [DEFAULT_UUID_KEY]: 42 }, 'json'), 'utf-8')

    const result = await readFolderUuid({ projectPath, format: 'json', extension: 'json' })
    expect(result).toBeUndefined()
  })

  it('does not generate a UUID or write the file', async () => {
    const result = await readFolderUuid({ projectPath, format: 'json', extension: 'json' })
    expect(result).toBeUndefined()
    expect(existsSync(join(projectPath, 'index.json'))).toBe(false)
  })
})

describe('ensureFileUuid', () => {
  it('creates the file with just the UUID when it does not exist yet', async () => {
    const filePath = join(projectPath, 'collection.yaml')
    const result = await ensureFileUuid({ filePath, format: 'yaml' })

    expect(result.generated).toBe(true)
    expect(existsSync(filePath)).toBe(true)
    const parsed = deserialize(await fs.readFile(filePath, 'utf-8'), 'yaml') as Record<string, unknown>
    expect(parsed[DEFAULT_UUID_KEY]).toBe(result.uuid)
  })

  it('returns the existing UUID and does not rewrite when already present', async () => {
    const filePath = join(projectPath, 'collection.yaml')
    await fs.writeFile(filePath, serialize({ [DEFAULT_UUID_KEY]: 'kept', items: [] }, 'yaml'), 'utf-8')
    const mtimeBefore = (await fs.stat(filePath)).mtimeMs

    await new Promise((r) => setTimeout(r, 10))
    const result = await ensureFileUuid({ filePath, format: 'yaml' })

    expect(result.generated).toBe(false)
    expect(result.uuid).toBe('kept')
    const mtimeAfter = (await fs.stat(filePath)).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
  })

  it('honors a custom uuidKey and preserves other top-level fields', async () => {
    const customKey = '_myAppUuid'
    const filePath = join(projectPath, 'collection.yaml')
    await fs.writeFile(filePath, serialize({ items: [1, 2, 3], name: 'Demo' }, 'yaml'), 'utf-8')

    const result = await ensureFileUuid({ filePath, format: 'yaml', uuidKey: customKey })

    expect(result.generated).toBe(true)
    const parsed = deserialize(await fs.readFile(filePath, 'utf-8'), 'yaml') as Record<string, unknown>
    expect(parsed[customKey]).toBe(result.uuid)
    expect(parsed[DEFAULT_UUID_KEY]).toBeUndefined()
    expect(parsed['name']).toBe('Demo')
    expect(parsed['items']).toEqual([1, 2, 3])
  })
})
