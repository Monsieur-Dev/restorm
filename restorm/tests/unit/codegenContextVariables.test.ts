import { describe, it, expect } from 'vitest'
import { flattenToVariableDefinitions } from '../../src/renderer/src/components/Design/codegenContextVariables'

describe('flattenToVariableDefinitions', () => {
  it('flattens nested objects to dotted paths and arrays to indexed paths', () => {
    const defs = flattenToVariableDefinitions({
      design: { name: 'RealEstate', defaultAuth: 'none' },
      route: { method: 'GET', fullPath: '/houses', params: [{ name: 'id' }, { name: 'slug' }] }
    })
    const byName = Object.fromEntries(defs.map((d) => [d.name, d.value]))
    expect(byName['design.name']).toBe('RealEstate')
    expect(byName['route.method']).toBe('GET')
    expect(byName['route.fullPath']).toBe('/houses')
    expect(byName['route.params.0.name']).toBe('id')
    expect(byName['route.params.1.name']).toBe('slug')
  })

  it('coerces primitives and skips null/undefined + non-primitive leaves', () => {
    const defs = flattenToVariableDefinitions({
      route: { cacheSeconds: 30, deprecated: true, summary: undefined, missing: null }
    })
    const names = defs.map((d) => d.name)
    expect(names).toContain('route.cacheSeconds')
    expect(defs.find((d) => d.name === 'route.cacheSeconds')?.value).toBe('30')
    expect(defs.find((d) => d.name === 'route.deprecated')?.value).toBe('true')
    expect(names).not.toContain('route.summary')
    expect(names).not.toContain('route.missing')
  })
})
