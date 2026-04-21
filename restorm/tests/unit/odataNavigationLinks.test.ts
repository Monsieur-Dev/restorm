import { describe, it, expect } from 'vitest'
import { extractNavigationLinks } from '../../src/shared/utils/odataNavigationLinks'

describe('extractNavigationLinks', () => {
  it('extracts top-level @odata.context and @odata.nextLink', () => {
    const body = {
      '@odata.context': 'https://api/$metadata#Pets',
      '@odata.nextLink': 'https://api/Pets?$skip=10',
      value: []
    }
    const out = extractNavigationLinks(body)
    expect(out.map((l) => l.key).sort()).toEqual(['@odata.context', '@odata.nextLink'])
    expect(out.find((l) => l.key === '@odata.nextLink')?.path).toBe('')
  })

  it('walks into value[] and captures per-item @odata.id / editLink / readLink', () => {
    const body = {
      value: [
        { '@odata.id': 'https://api/Pets(1)', '@odata.editLink': 'https://api/Pets(1)', Id: 1 },
        { '@odata.id': 'https://api/Pets(2)', '@odata.readLink': 'https://api/Pets(2)', Id: 2 }
      ]
    }
    const out = extractNavigationLinks(body)
    expect(out).toHaveLength(4)
    expect(out.find((l) => l.path === 'value[0]' && l.key === '@odata.editLink')?.url).toBe('https://api/Pets(1)')
    expect(out.find((l) => l.path === 'value[1]' && l.key === '@odata.readLink')?.url).toBe('https://api/Pets(2)')
  })

  it('picks up navigation-link annotations on property names (Category@odata.navigationLink)', () => {
    const body = {
      value: [
        { Id: 1, 'Category@odata.navigationLink': 'https://api/Pets(1)/Category' }
      ]
    }
    const out = extractNavigationLinks(body)
    expect(out).toHaveLength(1)
    expect(out[0]?.key).toBe('Category@odata.navigationLink')
    expect(out[0]?.url).toBe('https://api/Pets(1)/Category')
    expect(out[0]?.path).toBe('value[0]')
  })

  it('recurses into expanded navigation properties', () => {
    const body = {
      value: [
        {
          Id: 1,
          Category: { '@odata.id': 'https://api/Categories(5)', Id: 5 }
        }
      ]
    }
    const out = extractNavigationLinks(body)
    expect(out).toHaveLength(1)
    expect(out[0]?.path).toBe('value[0].Category')
  })

  it('de-duplicates identical key+url pairs', () => {
    const body = {
      '@odata.context': 'https://api/$metadata#Pets',
      value: [{ '@odata.context': 'https://api/$metadata#Pets' }]
    }
    const out = extractNavigationLinks(body)
    expect(out).toHaveLength(1)
  })

  it('returns [] for non-object / null input', () => {
    expect(extractNavigationLinks(null)).toEqual([])
    expect(extractNavigationLinks(undefined)).toEqual([])
    expect(extractNavigationLinks('plain')).toEqual([])
  })
})
