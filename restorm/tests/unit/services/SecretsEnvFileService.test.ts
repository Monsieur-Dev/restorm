import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getFolderSecretsEnvPath, saveFolderSecretsEnvFile } from '../../../src/main/services/SecretsEnvFileService'

describe('SecretsEnvFileService', () => {
  it('should write restorm.env to disk (folder mode)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'restorm-secrets-'))

    const data = {
      collections: [
        {
          name: 'Dossier',
          folderType: 'environment',
          environments: [
            {
              name: 'env parent',
              variables: [
                {
                  key: 'password',
                  value: { type: 'secret', source: 'envFileSecret', params: {}, resolved: 's3cr3t' }
                }
              ]
            }
          ],
          items: []
        }
      ]
    }

    await saveFolderSecretsEnvFile(dir, data)

    const envPath = getFolderSecretsEnvPath(dir)
    expect(existsSync(envPath)).toBe(true)

    const content = await readFile(envPath, 'utf-8')
    expect(content).toContain('1 - Dossier/env parent/password="s3cr3t"')
  })

  it('should delete restorm.env when there are no secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'restorm-secrets-'))
    const envPath = getFolderSecretsEnvPath(dir)

    // First write
    await saveFolderSecretsEnvFile(dir, {
      collections: [
        {
          name: 'Dossier',
          folderType: 'environment',
          environments: [
            {
              name: 'env parent',
              variables: [
                {
                  key: 'password',
                  value: { type: 'secret', source: 'envFileSecret', params: {}, resolved: 's3cr3t' }
                }
              ]
            }
          ],
          items: []
        }
      ]
    })
    expect(existsSync(envPath)).toBe(true)

    // Then save empty -> should remove
    await saveFolderSecretsEnvFile(dir, {
      collections: [
        {
          name: 'Dossier',
          folderType: 'environment',
          environments: [
            {
              name: 'env parent',
              variables: [{ key: 'notSecret', value: { type: 'string', value: 'x' } }]
            }
          ],
          items: []
        }
      ]
    })
    expect(existsSync(envPath)).toBe(false)
  })
})
