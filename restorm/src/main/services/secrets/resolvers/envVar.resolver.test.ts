import { describe, it, expect, afterEach } from 'vitest'
import { envVarResolver } from './envVar.resolver'
import { registerBuiltinSources, getResolver } from '../mainSourceRegistry'
import { valueSourceRegistry } from '../../../../shared/secrets/valueSourceRegistry'

const ctx = { scopeId: 'test' }

describe('envVarResolver', () => {
  afterEach(() => {
    delete process.env['TEST_SECRET_VAR']
  })

  it('reads a present environment variable', async () => {
    process.env['TEST_SECRET_VAR'] = 'super-secret'
    const result = await envVarResolver.read({ name: 'TEST_SECRET_VAR' }, ctx)
    expect(result).toBe('super-secret')
  })

  it('rejects with /not set/ when the variable is missing', async () => {
    await expect(
      envVarResolver.read({ name: 'TEST_SECRET_VAR_MISSING_XYZ' }, ctx)
    ).rejects.toThrow(/not set/)
  })

  it('rejects with /empty/ when name is an empty string', async () => {
    await expect(envVarResolver.read({ name: '' }, ctx)).rejects.toThrow(/empty/)
  })

  it('rejects with /empty/ when name is absent from params', async () => {
    await expect(envVarResolver.read({}, ctx)).rejects.toThrow(/empty/)
  })
})

describe('registerBuiltinSources', () => {
  it('registers the envVar descriptor in the shared registry', () => {
    registerBuiltinSources()
    const d = valueSourceRegistry.get('envVar')
    expect(d).toBeDefined()
    expect(d?.canWrite).toBe(false)
    expect(d?.paramSchema?.[0]?.key).toBe('name')
  })

  it('getResolver returns the envVar resolver', () => {
    registerBuiltinSources()
    const resolver = getResolver('envVar')
    expect(resolver).toBeDefined()
    expect(resolver?.id).toBe('envVar')
  })

  it('getResolver returns undefined for an unknown source', () => {
    registerBuiltinSources()
    expect(getResolver('__unknown__')).toBeUndefined()
  })

  it('is idempotent — calling twice does not throw and returns the same resolver', () => {
    registerBuiltinSources()
    registerBuiltinSources()
    expect(getResolver('envVar')?.id).toBe('envVar')
  })
})
