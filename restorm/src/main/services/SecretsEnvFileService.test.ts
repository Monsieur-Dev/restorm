// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upsertFolderSecretsEnvEntry, loadFolderSecretsEnvFile } from './SecretsEnvFileService'

vi.mock('electron-core-ui/main', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

let dir: string

describe('SecretsEnvFileService — serialized upserts (TOCTOU)', () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'restorm-env-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('does not lose entries when upserts race on the same file', async () => {
    // Without serialization both upserts read the (empty) file, then the
    // second write clobbers the first key. Serialized, both survive.
    await Promise.all([
      upsertFolderSecretsEnvEntry(dir, 'TOKEN_A', 'aaa'),
      upsertFolderSecretsEnvEntry(dir, 'TOKEN_B', 'bbb'),
      upsertFolderSecretsEnvEntry(dir, 'TOKEN_C', 'ccc')
    ])
    const vars = await loadFolderSecretsEnvFile(dir)
    expect(vars).toEqual({ TOKEN_A: 'aaa', TOKEN_B: 'bbb', TOKEN_C: 'ccc' })
  })

  it('last write wins for the same key', async () => {
    await Promise.all([
      upsertFolderSecretsEnvEntry(dir, 'TOKEN', 'first'),
      upsertFolderSecretsEnvEntry(dir, 'TOKEN', 'second')
    ])
    const vars = await loadFolderSecretsEnvFile(dir)
    expect(vars?.['TOKEN']).toBe('second')
  })
})
