import { describe, it, expect } from 'vitest'
import { collectEnvFileSecretsFromCollections, applyEnvFileSecretsToCollections } from './envFileSecrets'

interface SecretLike {
  resolved?: string
  params: { key?: string; folderPath?: string }
}

interface DocShape {
  collections: { items: { headers: { value: unknown }[] }[] }[]
}

/** Reach the single secret-bearing header value of the fixture document. */
function firstSecretValue(doc: Record<string, unknown>): SecretLike {
  const value = (doc as unknown as DocShape).collections[0]?.items[0]?.headers[0]?.value
  return value as SecretLike
}

function makeDoc(): Record<string, unknown> {
  return {
    collections: [
      {
        name: 'My API',
        folderType: 'http',
        items: [
          {
            type: 'http',
            name: 'Login',
            headers: [
              { key: 'Authorization', value: { type: 'secret', source: 'envFileSecret', params: {}, resolved: 'PLAINTEXT' } },
              { key: 'Accept', value: { type: 'string', value: 'application/json' } }
            ]
          }
        ]
      }
    ]
  }
}

describe('collectEnvFileSecretsFromCollections', () => {
  it('harvests resolved plaintext keyed by tree position and stamps params', () => {
    const doc = makeDoc()
    const secrets = collectEnvFileSecretsFromCollections(doc, '/projects/demo')
    const key = '1 - My API/1 - Login/headers/Authorization'
    expect(secrets[key]).toBe('PLAINTEXT')

    const value = firstSecretValue(doc)
    expect(value.params.key).toBe(key)
    expect(value.params.folderPath).toBe('/projects/demo')
  })

  it('ignores non-envFileSecret values', () => {
    const doc = makeDoc()
    const secrets = collectEnvFileSecretsFromCollections(doc)
    expect(Object.values(secrets)).toHaveLength(1)
  })
})

describe('applyEnvFileSecretsToCollections', () => {
  it('injects plaintext into resolved by positional key and stamps params', () => {
    const doc = makeDoc()
    // Wipe the in-memory plaintext as if freshly loaded from disk.
    const value = firstSecretValue(doc)
    delete value.resolved

    const key = '1 - My API/1 - Login/headers/Authorization'
    applyEnvFileSecretsToCollections(doc, { [key]: 'FROM_ENV_FILE' }, '/projects/demo')

    expect(value.resolved).toBe('FROM_ENV_FILE')
    expect(value.params.key).toBe(key)
    expect(value.params.folderPath).toBe('/projects/demo')
  })

  it('round-trips collect → apply', () => {
    const doc = makeDoc()
    const secrets = collectEnvFileSecretsFromCollections(doc, '/p')
    const value = firstSecretValue(doc)
    value.resolved = ''
    applyEnvFileSecretsToCollections(doc, secrets, '/p')
    expect(value.resolved).toBe('PLAINTEXT')
  })
})
