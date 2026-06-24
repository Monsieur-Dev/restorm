import { describe, it, expect } from 'vitest'
import {
  readQuickConfigId,
  readActionOverrides,
  applyActionFieldOverrides,
  resolveProjectConfigFields
} from './scenarioActionOverride'

describe('scenarioActionOverride readers', () => {
  it('reads a non-empty quick-config id, else undefined', () => {
    expect(readQuickConfigId({ quickConfigId: 'qc_1' })).toBe('qc_1')
    expect(readQuickConfigId({ quickConfigId: '' })).toBeUndefined()
    expect(readQuickConfigId({})).toBeUndefined()
    expect(readQuickConfigId({ quickConfigId: 42 })).toBeUndefined()
  })

  it('reads static overrides as an object, defaulting to empty', () => {
    expect(readActionOverrides({ overrides: { method: 'POST' } })).toEqual({ method: 'POST' })
    expect(readActionOverrides({})).toEqual({})
    expect(readActionOverrides({ overrides: [1, 2] })).toEqual({})
  })
})

describe('resolveProjectConfigFields (project configs only, by id)', () => {
  const request = {
    quickConfigs: [
      { id: 'qc-proj', storageTarget: 'project', fields: { url: 'https://proj' } },
      { id: 'qc-set', storageTarget: 'settings', fields: { url: 'https://settings' } },
      { id: 'qc-empty', storageTarget: 'project' }
    ]
  }

  it('resolves a project-target config by id to its fields', () => {
    expect(resolveProjectConfigFields(request, 'qc-proj')).toEqual({ url: 'https://proj' })
  })

  it('refuses a settings-target config (not portable with the .restorm file)', () => {
    expect(resolveProjectConfigFields(request, 'qc-set')).toBeUndefined()
  })

  it('returns an empty object for a project config with no fields', () => {
    expect(resolveProjectConfigFields(request, 'qc-empty')).toEqual({})
  })

  it('returns undefined for an unknown id (deleted config → config missing)', () => {
    expect(resolveProjectConfigFields(request, 'qc-gone')).toBeUndefined()
  })

  it('returns undefined when the request has no quickConfigs', () => {
    expect(resolveProjectConfigFields({}, 'qc-proj')).toBeUndefined()
    expect(resolveProjectConfigFields(null, 'qc-proj')).toBeUndefined()
  })
})

describe('applyActionFieldOverrides resolution order', () => {
  it('layers base → quickConfig → static override (most specific last)', () => {
    const base = { url: 'https://base', method: 'GET', timeout: 1000 }
    const quickConfig = { url: 'https://config', method: 'POST' }
    const overrides = { url: 'https://override' }
    const out = applyActionFieldOverrides(base, quickConfig, overrides)
    expect(out).toEqual({ url: 'https://override', method: 'POST', timeout: 1000 })
  })

  it('inherits a field from base when neither config nor override sets it', () => {
    const out = applyActionFieldOverrides({ url: 'https://base', method: 'GET' }, { method: 'POST' }, {})
    expect(out).toEqual({ url: 'https://base', method: 'POST' })
  })

  it('treats an undefined override value as inherit (tri-state clear)', () => {
    const out = applyActionFieldOverrides({ method: 'GET' }, { method: 'POST' }, { method: undefined })
    expect(out['method']).toBe('POST')
  })

  it('works with no quick-config (overrides on the bare request)', () => {
    const out = applyActionFieldOverrides({ url: 'a', method: 'GET' }, undefined, { method: 'DELETE' })
    expect(out).toEqual({ url: 'a', method: 'DELETE' })
  })

  it('deep-clones so a mutation of the result never touches the source', () => {
    const base = { headers: [{ key: 'a', value: '1' }] }
    const out = applyActionFieldOverrides(base, undefined, {})
    const outHeaders = out['headers'] as { value: string }[]
    outHeaders[0].value = 'mutated'
    const baseHeaders = base.headers as { value: string }[]
    expect(baseHeaders[0].value).toBe('1')
  })
})
