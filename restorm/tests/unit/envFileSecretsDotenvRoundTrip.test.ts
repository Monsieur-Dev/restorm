import { describe, expect, it } from 'vitest'
import {
  collectEnvFileSecretsFromCollections,
  applyEnvFileSecretsToCollections
} from '../../src/shared/utils/envFileSecrets'
import { parseEnvFileDetailed, serializeEnvFile } from '../../src/shared/utils/dotenv'

function makePaddingArray<T>(first: T, filler: () => T, count: number): T[] {
  const out: T[] = [first]
  while (out.length < count) out.push(filler())
  return out
}

function secretValue(resolved: string): Record<string, unknown> {
  return { type: 'secret', source: 'envFileSecret', params: {}, resolved }
}

describe('envFileSecrets ↔ restorm.env round-trip', () => {
  it('collects envFileSecret plaintext under padded positional keys and re-applies it', () => {
    const data: Record<string, unknown> = {
      collections: makePaddingArray(
        {
          name: 'Dossier',
          folderType: 'environment',
          environments: [
            {
              name: 'env parent',
              variables: [{ key: 'password', value: secretValue('s3cr3t') }]
            }
          ],
          items: makePaddingArray(
            {
              name: 'Sub',
              items: makePaddingArray(
                {
                  type: 'http',
                  name: 'GetUsers',
                  method: 'GET',
                  headers: [{ key: 'Authorization', value: secretValue('tok\nline2') }]
                },
                () => ({ type: 'http', name: 'Unused', method: 'GET', headers: [] }),
                10
              )
            },
            () => ({ name: 'Empty', items: [] }),
            10
          )
        },
        () => ({ name: 'Other', folderType: 'environment', environments: [], items: [] }),
        10
      )
    }

    const secrets = collectEnvFileSecretsFromCollections(data)

    // 10 siblings → 2-digit zero-padded index in every positional segment.
    expect(secrets['01 - Dossier/env parent/password']).toBe('s3cr3t')
    expect(secrets['01 - Dossier/01 - Sub/01 - GetUsers/headers/Authorization']).toBe('tok\nline2')

    // Plaintext (including newlines) survives the restorm.env serialize → parse round-trip.
    const envText = serializeEnvFile(secrets)
    const parsed = parseEnvFileDetailed(envText)
    expect(parsed.duplicates).toEqual([])

    // Simulate persisted data where the resolved plaintext is stripped (as on disk).
    const persisted: Record<string, unknown> = JSON.parse(JSON.stringify(data))
    ;((persisted.collections as unknown[])[0] as Record<string, unknown>)['environments'] = [
      {
        name: 'env parent',
        variables: [{ key: 'password', value: { type: 'secret', source: 'envFileSecret', params: {} } }]
      }
    ]
    const firstItems = ((persisted.collections as unknown[])[0] as Record<string, unknown>)['items'] as unknown[]
    const sub = firstItems[0] as Record<string, unknown>
    const subItems = sub['items'] as unknown[]
    const req = subItems[0] as Record<string, unknown>
    req['headers'] = [
      { key: 'Authorization', value: { type: 'secret', source: 'envFileSecret', params: {} } }
    ]

    applyEnvFileSecretsToCollections(persisted, parsed.vars)

    const env0 = (((persisted.collections as unknown[])[0] as Record<string, unknown>)['environments'] as unknown[])[0] as Record<string, unknown>
    const envVar0 = (env0['variables'] as unknown[])[0] as Record<string, unknown>
    expect((envVar0['value'] as Record<string, unknown>)['resolved']).toBe('s3cr3t')

    const req0 = (((((persisted.collections as unknown[])[0] as Record<string, unknown>)['items'] as unknown[])[0] as Record<string, unknown>)['items'] as unknown[])[0] as Record<string, unknown>
    const hdr0 = (req0['headers'] as unknown[])[0] as Record<string, unknown>
    expect((hdr0['value'] as Record<string, unknown>)['resolved']).toBe('tok\nline2')
  })
})
