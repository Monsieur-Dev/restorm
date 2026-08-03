import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// `fs` is deliberately NOT mocked here: the guarantee under test is that a
// refused open leaves the bytes on disk untouched, and a mocked filesystem
// could only ever prove that the mock was not called. Everything else —
// Electron, storage, logging — is stubbed so the service can run headless.

const broadcasts: { channel: string; args: unknown[] }[] = []

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: (): boolean => false,
        webContents: {
          send: (channel: string, ...args: unknown[]): void => {
            broadcasts.push({ channel, args })
          }
        }
      }
    ]),
    getFocusedWindow: vi.fn(() => null)
  }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const storage = new Map<string, unknown>()
vi.mock('./StorageService', () => ({
  getStorageService: vi.fn(() => ({
    get: (key: string): unknown => storage.get(key),
    set: (key: string, value: unknown): void => { storage.set(key, value) },
    has: (key: string): boolean => storage.has(key),
    delete: (key: string): void => { storage.delete(key) }
  }))
}))

vi.mock('./I18nService', () => ({ i18nService: { t: vi.fn((k: string) => k) } }))

import { FileService } from './FileService'
import type { OpenValidationResult } from '../../types/file'

const UUID_KEY = '_projectUuid'

describe('FileService — validateOnOpen gate', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    broadcasts.length = 0
    storage.clear()
    vi.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'ecui-open-guard-'))
    filePath = join(dir, 'project.testapp')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const makeService = (validateOnOpen?: (content: unknown, path: string) => OpenValidationResult): FileService =>
    new FileService({
      storagePrefix: 'guard_',
      extension: '.testapp',
      defaultFormat: 'json',
      uuidKey: UUID_KEY,
      ...(validateOnOpen && { validateOnOpen })
    })

  describe('a refused document', () => {
    it('leaves the file byte-for-byte identical', async () => {
      // No UUID in the file: the stamp would fire here if the gate ran
      // after it, which is exactly the regression this asserts against.
      const original = '{\n  "collections": [],\n  "trailing": "whitespace preserved"   \n}\n'
      writeFileSync(filePath, original, 'utf-8')
      const before = readFileSync(filePath)

      const service = makeService(() => ({ ok: false, code: 'nope' }))
      const result = await service.open(filePath)

      expect(result.success).toBe(false)
      expect(result.rejected).toBe(true)
      expect(readFileSync(filePath).equals(before)).toBe(true)
      // Byte equality is the contract; spell out the UUID absence too so a
      // failure says *what* got written rather than just "bytes differ".
      expect(readFileSync(filePath, 'utf-8')).not.toContain(UUID_KEY)
    })

    it('does not become the current file', async () => {
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const service = makeService(() => ({ ok: false }))

      await service.open(filePath)

      expect(service.getState().currentFile.path).toBeNull()
      expect(service.getState().currentFile.content).toBeNull()
    })

    it('does not join recent files', async () => {
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const service = makeService(() => ({ ok: false }))

      await service.open(filePath)

      expect(service.getState().recentFiles).toHaveLength(0)
    })

    it('broadcasts file:open-rejected with the validator code and detail', async () => {
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const service = makeService(() => ({
        ok: false,
        code: 'file-format-too-new',
        detail: { found: 7, current: 1 }
      }))

      await service.open(filePath)

      const rejection = broadcasts.find((b) => b.channel === 'file:open-rejected')
      expect(rejection).toBeDefined()
      expect(rejection?.args[0]).toEqual({
        path: filePath,
        code: 'file-format-too-new',
        detail: { found: 7, current: 1 }
      })
      // The renderer must not also receive an "opened" event for a
      // document that was refused.
      expect(broadcasts.some((b) => b.channel === 'file:opened')).toBe(false)
    })

    it('preserves the previously open document', async () => {
      const goodPath = join(dir, 'good.testapp')
      writeFileSync(goodPath, '{"collections":[],"marker":"first"}', 'utf-8')
      writeFileSync(filePath, '{"collections":[],"marker":"second"}', 'utf-8')

      let refuse = false
      const service = makeService(() => (refuse ? { ok: false } : { ok: true }))

      await service.open(goodPath)
      expect(service.getState().currentFile.path).toBe(goodPath)

      refuse = true
      await service.open(filePath)

      // Still the first document — a refusal must not half-close what the
      // user already had open.
      expect(service.getState().currentFile.path).toBe(goodPath)
      expect((service.getState().currentFile.content as { marker?: string }).marker).toBe('first')
    })

    it('refuses when the validator throws, rather than letting the error escape', async () => {
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const before = readFileSync(filePath)
      const service = makeService(() => {
        throw new Error('validator exploded')
      })

      const result = await service.open(filePath)

      expect(result.success).toBe(false)
      expect(result.rejected).toBe(true)
      expect(readFileSync(filePath).equals(before)).toBe(true)
    })
  })

  describe('the accepting path is unchanged', () => {
    it('still stamps the uuid on a file that has none', async () => {
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const service = makeService(() => ({ ok: true }))

      const result = await service.open(filePath)

      expect(result.success).toBe(true)
      const onDisk = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
      expect(typeof onDisk[UUID_KEY]).toBe('string')
      expect((onDisk[UUID_KEY] as string).length).toBeGreaterThan(0)
    })

    it('publishes the stamped uuid to the renderer, not the pre-stamp content', async () => {
      // The content broadcast with `file:opened` is what the renderer keys
      // per-project preferences off; if the reorder handed back the bytes
      // read before stamping, that identity would be missing on first open.
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const service = makeService(() => ({ ok: true }))

      await service.open(filePath)

      const onDisk = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
      const published = service.getState().currentFile.content as Record<string, unknown>
      expect(published[UUID_KEY]).toBe(onDisk[UUID_KEY])
    })

    it('preserves an existing uuid instead of regenerating it', async () => {
      writeFileSync(filePath, JSON.stringify({ collections: [], [UUID_KEY]: 'kept-uuid' }), 'utf-8')
      const service = makeService(() => ({ ok: true }))

      await service.open(filePath)

      const onDisk = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
      expect(onDisk[UUID_KEY]).toBe('kept-uuid')
      expect((service.getState().currentFile.content as Record<string, unknown>)[UUID_KEY]).toBe('kept-uuid')
    })

    it('does not rewrite a file that already carries a uuid', async () => {
      const original = JSON.stringify({ collections: [], [UUID_KEY]: 'kept-uuid' })
      writeFileSync(filePath, original, 'utf-8')
      const before = readFileSync(filePath)
      const service = makeService(() => ({ ok: true }))

      await service.open(filePath)

      expect(readFileSync(filePath).equals(before)).toBe(true)
    })

    it('adds the file to recent files and broadcasts file:opened', async () => {
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const service = makeService(() => ({ ok: true }))

      await service.open(filePath)

      expect(service.getState().currentFile.path).toBe(filePath)
      expect(service.getState().recentFiles.map((f) => f.path)).toContain(filePath)
      expect(broadcasts.some((b) => b.channel === 'file:opened')).toBe(true)
      expect(broadcasts.some((b) => b.channel === 'file:open-rejected')).toBe(false)
    })
  })

  describe('an accepted open preserves what the user authored', () => {
    // Opening a document is not an edit. Stamping the identity used to go
    // through parse → serialise, which silently discarded everything the
    // format carries but the object model does not.
    const yamlPath = (): string => join(dir, 'authored.yaml')

    const makeYamlService = (): FileService =>
      new FileService({
        storagePrefix: 'guard_',
        extension: '.yaml',
        defaultFormat: 'yaml',
        uuidKey: UUID_KEY
      })

    it('keeps comments in a file that had no uuid', async () => {
      const original = [
        '# Team defaults — do not reorder.',
        'name: My project  # shown in the title bar',
        '',
        '# Only applies to staging.',
        'timeout: 30',
        ''
      ].join('\n')
      writeFileSync(yamlPath(), original, 'utf-8')

      await makeYamlService().open(yamlPath())

      const after = readFileSync(yamlPath(), 'utf-8')
      expect(after).toContain('# Team defaults — do not reorder.')
      expect(after).toContain('# shown in the title bar')
      expect(after).toContain('# Only applies to staging.')
      expect(after).toContain(UUID_KEY)
    })

    it('keeps anchors and aliases instead of expanding them', async () => {
      const original = [
        'defaults: &defaults',
        '  retries: 3',
        'staging:',
        '  <<: *defaults',
        '  host: stg.example.com',
        ''
      ].join('\n')
      writeFileSync(yamlPath(), original, 'utf-8')

      await makeYamlService().open(yamlPath())

      const after = readFileSync(yamlPath(), 'utf-8')
      expect(after).toContain('&defaults')
      expect(after).toContain('*defaults')
      // Expansion would have duplicated the anchored block.
      expect(after.match(/retries: 3/g)).toHaveLength(1)
    })

    it('leaves the file untouched when the identity cannot be added safely', async () => {
      // A sequence root has nowhere to put a top-level key. Rewriting it
      // through the object model is exactly the damage being avoided, so
      // the file must survive unchanged even though that costs the uuid.
      const original = '- first\n- second\n'
      writeFileSync(yamlPath(), original, 'utf-8')
      const before = readFileSync(yamlPath())

      await makeYamlService().open(yamlPath())

      expect(readFileSync(yamlPath()).equals(before)).toBe(true)
    })
  })

  describe('with no validator configured', () => {
    it('opens normally and stamps the uuid, exactly as before', async () => {
      writeFileSync(filePath, '{"collections":[]}', 'utf-8')
      const service = makeService()

      const result = await service.open(filePath)

      expect(result.success).toBe(true)
      expect(result.rejected).toBeUndefined()
      expect(service.getState().currentFile.path).toBe(filePath)
      const onDisk = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
      expect(typeof onDisk[UUID_KEY]).toBe('string')
    })
  })
})
