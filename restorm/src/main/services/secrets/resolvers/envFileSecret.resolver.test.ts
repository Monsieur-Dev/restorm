import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { envFileSecretResolver } from './envFileSecret.resolver'
import { registerBuiltinSources, getResolver } from '../mainSourceRegistry'
import { valueSourceRegistry } from '../../../../shared/secrets/valueSourceRegistry'

const ctx = { scopeId: 'test' }

describe('envFileSecretResolver', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'restorm-envfilesecret-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the plaintext for a key from restorm.env', async () => {
    await envFileSecretResolver.write?.({ key: 'C/R/headers/Authorization', folderPath: dir }, 's3cr3t', ctx)
    const result = await envFileSecretResolver.read({ key: 'C/R/headers/Authorization', folderPath: dir }, ctx)
    expect(result).toBe('s3cr3t')
  })

  it('write creates restorm.env and read round-trips it', async () => {
    expect(existsSync(join(dir, 'restorm.env'))).toBe(false)
    await envFileSecretResolver.write?.({ key: 'a/b/c', folderPath: dir }, 'value-1', ctx)
    const envText = readFileSync(join(dir, 'restorm.env'), 'utf-8')
    expect(envText).toContain('value-1')
    const result = await envFileSecretResolver.read({ key: 'a/b/c', folderPath: dir }, ctx)
    expect(result).toBe('value-1')
  })

  it('write preserves other entries (upsert, not overwrite)', async () => {
    await envFileSecretResolver.write?.({ key: 'first', folderPath: dir }, 'one', ctx)
    await envFileSecretResolver.write?.({ key: 'second', folderPath: dir }, 'two', ctx)
    expect(await envFileSecretResolver.read({ key: 'first', folderPath: dir }, ctx)).toBe('one')
    expect(await envFileSecretResolver.read({ key: 'second', folderPath: dir }, ctx)).toBe('two')
  })

  it('rejects when the key is missing from the file', async () => {
    await envFileSecretResolver.write?.({ key: 'present', folderPath: dir }, 'x', ctx)
    await expect(
      envFileSecretResolver.read({ key: 'absent', folderPath: dir }, ctx)
    ).rejects.toThrow(/not found/)
  })

  it('rejects when an owning folderPath is present but the key is empty', async () => {
    await expect(envFileSecretResolver.read({ key: '', folderPath: dir }, ctx)).rejects.toThrow(/key is empty/)
  })

  it('resolves to empty when there is no owning folderPath (unstamped placeholder)', async () => {
    // An env-file secret that was seeded as a placeholder (e.g. by an import)
    // and never saved into a project folder has no `restorm.env` to read — and
    // a single-file collection can never stamp a folderPath at all. It is the
    // masked empty state, not a misconfiguration, so it must NOT throw:
    // throwing would abort the dispatch of any request whose env chain merely
    // contains the unstamped secret, even when the key was already computed.
    await expect(envFileSecretResolver.read({}, ctx)).resolves.toBe('')
    await expect(envFileSecretResolver.read({ key: '', folderPath: '' }, ctx)).resolves.toBe('')
    await expect(envFileSecretResolver.read({ key: 'C/R/headers/Auth', folderPath: '' }, ctx)).resolves.toBe('')
  })
})

describe('registerBuiltinSources — envFileSecret', () => {
  it('registers the envFileSecret descriptor (writable)', () => {
    registerBuiltinSources()
    const d = valueSourceRegistry.get('envFileSecret')
    expect(d).toBeDefined()
    expect(d?.canWrite).toBe(true)
    expect(d?.configComponent).toBe('envFileSecret')
  })

  it('getResolver returns the envFileSecret resolver', () => {
    registerBuiltinSources()
    expect(getResolver('envFileSecret')?.id).toBe('envFileSecret')
  })
})
