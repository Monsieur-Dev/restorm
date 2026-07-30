/**
 * Unit tests for `ImportManager`'s source resolution — how an import
 * `source` string becomes raw content.
 *
 * The import modal's source field doubles as a paste area (and its drop
 * handler falls back to a `text/plain` selection), so the string arriving
 * here is a URL, a path, OR the payload itself. Resolving a payload as a
 * path is what surfaces an ENOENT quoting the user's own paste back at
 * them, so these tests pin all three readings — plus the two places the
 * distinction leaks into the providers: `detectFormat`'s extension-anchored
 * pass and `ImportProvider.parse`'s `opts.filePath`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// `readImportSource`'s file branch logs via `electron-core-ui/main`'s
// logger, which lazily reads Electron's `app.isPackaged` on first call —
// not available outside a running Electron process. Same mock shape the
// other main-process unit tests use.
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { importFrom, classifyImportSource } = await import('../../src/main/services/import/ImportManager')

const CURL_ONE = "curl -X GET 'https://api.example.com/pets' -H 'Accept: application/json'"
const CURL_TWO = "curl -X POST 'https://api.example.com/pets' -H 'Content-Type: application/json' -d '{\"name\":\"Rex\"}'"

const POSTMAN_FIXTURE = join(__dirname, 'postman-petstore.json')
const TYPESPEC_FIXTURE = join(__dirname, 'fixtures/typespec/petstore.tsp')

/** A leaf of an imported tree, narrowed to what these tests assert on. */
interface ImportedLeaf {
  method?: string
  url?: string
  name?: string
}

/**
 * Every leaf of a freshly-imported tree, depth-first. Folders are the
 * nodes carrying `items` (the same structural test the import modal walks
 * the preview tree with), so anything else is a request.
 */
function flattenRequests(items: readonly unknown[]): ImportedLeaf[] {
  const out: ImportedLeaf[] = []
  const visit = (item: unknown): void => {
    if (item === null || typeof item !== 'object') return
    const children = (item as { items?: unknown }).items
    if (Array.isArray(children)) {
      for (const child of children) visit(child)
      return
    }
    out.push(item as ImportedLeaf)
  }
  for (const item of items) visit(item)
  return out
}

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'restorm-import-source-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('classifyImportSource', () => {
  it('classifies an http(s) source as a URL', async () => {
    await expect(classifyImportSource('https://api.example.com/openapi.json')).resolves.toBe('url')
    await expect(classifyImportSource('http://localhost:8080/spec')).resolves.toBe('url')
  })

  it('classifies an existing file as a file', async () => {
    await expect(classifyImportSource(POSTMAN_FIXTURE)).resolves.toBe('file')
  })

  it('classifies a pasted curl command as content', async () => {
    await expect(classifyImportSource(CURL_ONE)).resolves.toBe('content')
  })

  it('classifies a pasted document as content', async () => {
    await expect(classifyImportSource(readFileSync(POSTMAN_FIXTURE, 'utf-8'))).resolves.toBe('content')
  })

  it('classifies a path-shaped input that does not exist as a file, so the errno survives', async () => {
    await expect(classifyImportSource('/no/such/spec.json')).resolves.toBe('file')
    await expect(classifyImportSource('./nope.yaml')).resolves.toBe('file')
    await expect(classifyImportSource('~/nope.yaml')).resolves.toBe('file')
  })

  it('keeps a directory on the file branch so its read error is the honest one', async () => {
    // `stat().isFile()` is false for a directory, but it is still
    // path-SHAPED — the user named a location. Reading it fails with
    // EISDIR, which says far more than parsing the path as a document.
    await expect(classifyImportSource(tmpDir)).resolves.toBe('file')
    const result = await importFrom(tmpDir)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/EISDIR|illegal operation on a directory/i)
  })
})

describe('importFrom — pasted content', () => {
  it('parses a pasted curl command instead of reading it as a path', async () => {
    const result = await importFrom(CURL_ONE)

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(result.format).toBe('curl')

    const requests = flattenRequests(result.items)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'GET', url: 'https://api.example.com/pets' })
  })

  it('parses several pasted curl commands into one request each', async () => {
    const result = await importFrom(`${CURL_ONE}\n${CURL_TWO}`)

    expect(result.success).toBe(true)
    expect(result.format).toBe('curl')
    expect(flattenRequests(result.items).map((r) => r.method)).toEqual(['GET', 'POST'])
  })

  it('never reports a filesystem error for a pasted command', async () => {
    const result = await importFrom(CURL_ONE)
    // The whole point: the payload must not reach `fs.readFile`.
    expect(result.error ?? '').not.toMatch(/ENOENT|no such file/i)
  })

  it('routes a pasted document through content detection', async () => {
    const result = await importFrom(readFileSync(POSTMAN_FIXTURE, 'utf-8'))

    expect(result.success).toBe(true)
    expect(result.format).toBe('postman')
    expect(flattenRequests(result.items).length).toBeGreaterThan(0)
  })

  it('does not let pasted content pose as a filename', async () => {
    // `detectFormat` gives an extension-anchored provider priority over
    // any content sniff, probing `canImport('', filePath)`. TypeSpec
    // claims a path on `.tsp` ALONE, so a paste offered up as a path
    // would hijack this ordinary curl command — its URL happens to end
    // in `.tsp`. Pasted content has no path, and that's what keeps the
    // command with the curl provider.
    const result = await importFrom('curl -O https://api.example.com/model.tsp')

    expect(result.format).toBe('curl')
    expect(result.success).toBe(true)
    expect(flattenRequests(result.items)).toHaveLength(1)
  })
})

describe('importFrom — real files', () => {
  it('still reads and imports an on-disk file', async () => {
    const path = join(tmpDir, 'collection.json')
    await fs.writeFile(path, readFileSync(POSTMAN_FIXTURE, 'utf-8'), 'utf-8')

    const result = await importFrom(path)

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(result.format).toBe('postman')
    expect(result.source).toBe(path)
    expect(flattenRequests(result.items).length).toBeGreaterThan(0)
  })

  it('still threads the real path to the providers that need one', async () => {
    // TypeSpec is detected by extension and refuses to parse without
    // `opts.filePath`, so a green result here proves the path reached
    // both `detectFormat` and `ImportProvider.parse`.
    const path = join(tmpDir, 'petstore.tsp')
    await fs.writeFile(path, readFileSync(TYPESPEC_FIXTURE, 'utf-8'), 'utf-8')

    const result = await importFrom(path)

    expect(result.format).toBe('typespec')
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('reports the missing file for a path-shaped typo, not a detection failure', async () => {
    const missing = join(tmpDir, 'does-not-exist.json')

    const result = await importFrom(missing)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ENOENT/)
    expect(result.error).toContain(missing)
  })
})
