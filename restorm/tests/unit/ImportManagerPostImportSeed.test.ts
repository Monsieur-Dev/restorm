/**
 * Unit tests for `ImportManager.runPostImportSeed` — the generic dispatcher
 * that re-reads an import `source` and hands it to the matching format's
 * `ImportProvider.postImportSeed` (see `registry.ts`), with a checksum guard
 * against the source having changed since the original `importFrom` call.
 */

import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { storeExecutionResult } = vi.hoisted(() => ({ storeExecutionResult: vi.fn() }))
vi.mock('../../src/main/services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult }
}))

// `readImportSource`'s file-path branch logs via `electron-core-ui/main`'s
// logger, which lazily reads Electron's `app.isPackaged` on first call — not
// available outside a running Electron process. Same mock shape other
// main-process unit tests use (see `CodeSnippetGenerator.test.ts`).
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { runPostImportSeed } = await import('../../src/main/services/import/ImportManager')
const { pairHarEntriesWithRequestIds } = await import('../../src/main/services/import/HarImportService')
type HarFile = import('../../src/main/services/import/HarImportService').HarFile

const fixturePath = join(__dirname, 'fixtures/har/petstore.har')
const fixture = readFileSync(fixturePath, 'utf-8')
const fixtureChecksum = `sha256:${createHash('sha256').update(fixture).digest('hex')}`

describe('ImportManager.runPostImportSeed', () => {
  it('is a no-op success for a format with no postImportSeed', async () => {
    storeExecutionResult.mockClear()
    const result = await runPostImportSeed(fixturePath, 'openapi-3.0', undefined)
    expect(result).toEqual({ success: true })
    expect(storeExecutionResult).not.toHaveBeenCalled()
  })

  it('is a no-op success for an unregistered format', async () => {
    const result = await runPostImportSeed(fixturePath, 'does-not-exist', undefined)
    expect(result).toEqual({ success: true })
  })

  it('re-reads the source and seeds via the format provider, remapping through idMap', async () => {
    storeExecutionResult.mockClear()
    const har = JSON.parse(fixture) as HarFile
    const pairs = pairHarEntriesWithRequestIds(har)
    const idMap: Record<string, string> = {}
    for (const { requestId } of pairs) idMap[requestId] = `final-${requestId}`

    const result = await runPostImportSeed(fixturePath, 'har', idMap)

    expect(result).toEqual({ success: true })
    expect(storeExecutionResult).toHaveBeenCalledTimes(pairs.length)
    expect(storeExecutionResult).toHaveBeenCalledWith(
      `final-${pairs[0]?.requestId}`,
      'http',
      expect.objectContaining({ requestId: `final-${pairs[0]?.requestId}` })
    )
  })

  it('treats a missing idMap as identity (the MCP import-tool caller, ids unchanged)', async () => {
    storeExecutionResult.mockClear()
    const har = JSON.parse(fixture) as HarFile
    const pairs = pairHarEntriesWithRequestIds(har)

    await runPostImportSeed(fixturePath, 'har', undefined)

    expect(storeExecutionResult).toHaveBeenCalledWith(
      pairs[0]?.requestId,
      'http',
      expect.objectContaining({ requestId: pairs[0]?.requestId })
    )
  })

  it('skips seeding when expectedChecksum no longer matches the re-read content', async () => {
    storeExecutionResult.mockClear()
    const result = await runPostImportSeed(fixturePath, 'har', undefined, {
      expectedChecksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/changed/i)
    expect(storeExecutionResult).not.toHaveBeenCalled()
  })

  it('seeds normally when expectedChecksum matches', async () => {
    storeExecutionResult.mockClear()
    const result = await runPostImportSeed(fixturePath, 'har', undefined, {
      expectedChecksum: fixtureChecksum
    })
    expect(result).toEqual({ success: true })
    expect(storeExecutionResult).toHaveBeenCalled()
  })

  it('reports failure (not a throw) when the source can no longer be read', async () => {
    const result = await runPostImportSeed(join(__dirname, 'fixtures/har/does-not-exist.har'), 'har', undefined)
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
