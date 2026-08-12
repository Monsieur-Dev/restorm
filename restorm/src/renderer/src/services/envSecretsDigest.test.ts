import { describe, it, expect } from 'vitest'
import { envSecretsDigestOf, findNodeByRuntimeId } from './envSecretsDigest'
import { SecretValue } from '../../../shared/types/valueTypes/SecretValue'

describe('envSecretsDigestOf', () => {
  const envFolder = (resolved?: string): Record<string, unknown> => {
    const sv = new SecretValue('envFileSecret', { key: 'EnvF/Dev/secret' })
    if (resolved !== undefined) sv.resolved = resolved
    return {
      id: 'ef', folderType: 'environment', items: [],
      environments: [{ id: 'env', name: 'Dev', variables: [{ key: 'secret', value: sv }] }]
    }
  }

  it('is null for a subtree with no env-file secret (shape stays historical)', () => {
    expect(envSecretsDigestOf({ id: 'r', type: 'http', url: 'x' })).toBeNull()
  })

  it('changes when (and only when) a resolved plaintext changes', () => {
    const before = envSecretsDigestOf(envFolder('one'))
    const same = envSecretsDigestOf(envFolder('one'))
    const after = envSecretsDigestOf(envFolder('two'))
    const cleared = envSecretsDigestOf(envFolder(undefined))
    expect(before).toBe(same)
    expect(before).not.toBe(after)
    expect(before).not.toBe(cleared)
  })

  it('sees POJO-shaped secrets too (post-round-trip trees)', () => {
    const digest = envSecretsDigestOf({
      variables: [{ key: 's', value: { type: 'secret', source: 'envFileSecret', params: { key: 'K' }, resolved: 'v' } }]
    })
    expect(digest).toContain('"v"')
  })
})

describe('findNodeByRuntimeId', () => {
  it('finds items, environments and sub-environments', () => {
    const tree = [{
      id: 'root', items: [{ id: 'req1' }],
      environments: [{ id: 'env1', subEnvironments: [{ id: 'sub1' }] }]
    }]
    expect((findNodeByRuntimeId(tree, 'req1') as { id: string }).id).toBe('req1')
    expect((findNodeByRuntimeId(tree, 'sub1') as { id: string }).id).toBe('sub1')
    expect(findNodeByRuntimeId(tree, 'nope')).toBeNull()
  })
})
