/**
 * Unit tests for the OData server-side query-option executor.
 * Pure functions — no electron, no renderer.
 */

import { describe, it, expect } from 'vitest'
import {
  applyODataQuery,
  parseFilter,
  parsePagingValue,
  type ODataEntity,
  type ExpandResolver
} from '../../src/shared/utils/odataServerQuery'

// An in-memory petstore-shaped collection (mirrors the v4 fixture's
// Pet entity: Id, Name, Status, CategoryId, with a nested Category and a
// to-many Tags relationship resolved via the ExpandResolver).
const categories: Record<number, ODataEntity> = {
  1: { Id: 1, Name: 'Dogs' },
  2: { Id: 2, Name: 'Cats' }
}

const tagsByPet: Record<number, ODataEntity[]> = {
  1: [
    { Id: 10, Name: 'friendly' },
    { Id: 11, Name: 'large' }
  ],
  2: [{ Id: 12, Name: 'small' }],
  3: []
}

const pets: ODataEntity[] = [
  { Id: 1, Name: 'Rex', Status: 'Available', CategoryId: 1, Age: 4 },
  { Id: 2, Name: 'Whiskers', Status: 'Pending', CategoryId: 2, Age: 2 },
  { Id: 3, Name: 'Rover', Status: 'Available', CategoryId: 1, Age: 7 }
]

const resolver: ExpandResolver = (entity, navProperty) => {
  if (navProperty === 'Category') {
    const id = entity['CategoryId']
    return typeof id === 'number' ? categories[id] : undefined
  }
  if (navProperty === 'Tags') {
    const id = entity['Id']
    return typeof id === 'number' ? tagsByPet[id] : undefined
  }
  return undefined
}

describe('applyODataQuery — $filter', () => {
  it('eq on a string property', () => {
    const { value } = applyODataQuery(pets, { filter: "Name eq 'Rex'" })
    expect(value.map((p) => p['Id'])).toEqual([1])
  })

  it('ne on a string property', () => {
    const { value } = applyODataQuery(pets, { filter: "Status ne 'Available'" })
    expect(value.map((p) => p['Id'])).toEqual([2])
  })

  it('gt / ge / lt / le on a numeric property', () => {
    expect(applyODataQuery(pets, { filter: 'Age gt 4' }).value.map((p) => p['Id'])).toEqual([3])
    expect(applyODataQuery(pets, { filter: 'Age ge 4' }).value.map((p) => p['Id'])).toEqual([1, 3])
    expect(applyODataQuery(pets, { filter: 'Age lt 4' }).value.map((p) => p['Id'])).toEqual([2])
    expect(applyODataQuery(pets, { filter: 'Age le 4' }).value.map((p) => p['Id'])).toEqual([1, 2])
  })

  it('and / or / not with parentheses', () => {
    expect(
      applyODataQuery(pets, { filter: "Status eq 'Available' and Age gt 5" }).value.map((p) => p['Id'])
    ).toEqual([3])
    expect(
      applyODataQuery(pets, { filter: "Name eq 'Rex' or Name eq 'Whiskers'" }).value.map((p) => p['Id'])
    ).toEqual([1, 2])
    expect(
      applyODataQuery(pets, { filter: "not (Status eq 'Available')" }).value.map((p) => p['Id'])
    ).toEqual([2])
    expect(
      applyODataQuery(pets, { filter: "(Age lt 3 or Age gt 6) and Status eq 'Available'" }).value.map(
        (p) => p['Id']
      )
    ).toEqual([3])
  })

  it('string functions contains / startswith / endswith', () => {
    // "ov" is unique to Rover; "R" prefixes Rex + Rover; "x" suffixes only Rex.
    expect(applyODataQuery(pets, { filter: "contains(Name,'ov')" }).value.map((p) => p['Id'])).toEqual([3])
    expect(applyODataQuery(pets, { filter: "startswith(Name,'R')" }).value.map((p) => p['Id'])).toEqual([
      1, 3
    ])
    expect(applyODataQuery(pets, { filter: "endswith(Name,'x')" }).value.map((p) => p['Id'])).toEqual([1])
  })

  it('eq null matches only missing/null values', () => {
    const data: ODataEntity[] = [{ Id: 1, Owner: null }, { Id: 2, Owner: 'Sam' }, { Id: 3 }]
    expect(applyODataQuery(data, { filter: 'Owner eq null' }).value.map((p) => p['Id'])).toEqual([1, 3])
  })

  it('a dotted property path reads into a nested object', () => {
    const data: ODataEntity[] = [
      { Id: 1, Category: { Name: 'Dogs' } },
      { Id: 2, Category: { Name: 'Cats' } }
    ]
    expect(applyODataQuery(data, { filter: "Category/Name eq 'Cats'" }).value.map((p) => p['Id'])).toEqual([
      2
    ])
  })

  it('does not mutate the input collection', () => {
    const snapshot = JSON.parse(JSON.stringify(pets))
    applyODataQuery(pets, { filter: "Name eq 'Rex'", select: ['Name'] })
    expect(pets).toEqual(snapshot)
  })
})

describe('applyODataQuery — $orderby', () => {
  it('single key ascending (default)', () => {
    expect(applyODataQuery(pets, { orderby: 'Age' }).value.map((p) => p['Id'])).toEqual([2, 1, 3])
  })

  it('single key descending', () => {
    expect(applyODataQuery(pets, { orderby: 'Age desc' }).value.map((p) => p['Id'])).toEqual([3, 1, 2])
  })

  it('multi-key asc/desc', () => {
    const data: ODataEntity[] = [
      { Id: 1, Status: 'Available', Age: 4 },
      { Id: 2, Status: 'Available', Age: 7 },
      { Id: 3, Status: 'Pending', Age: 2 }
    ]
    expect(
      applyODataQuery(data, { orderby: 'Status asc,Age desc' }).value.map((p) => p['Id'])
    ).toEqual([2, 1, 3])
  })

  it('orders nulls first ascending', () => {
    const data: ODataEntity[] = [{ Id: 1, Age: 5 }, { Id: 2 }, { Id: 3, Age: 1 }]
    expect(applyODataQuery(data, { orderby: 'Age' }).value.map((p) => p['Id'])).toEqual([2, 3, 1])
  })
})

describe('applyODataQuery — $select', () => {
  it('projects only the listed properties', () => {
    const { value } = applyODataQuery(pets, { select: ['Name'] })
    expect(value).toEqual([{ Name: 'Rex' }, { Name: 'Whiskers' }, { Name: 'Rover' }])
  })

  it('preserves @odata annotations through a projection', () => {
    const data: ODataEntity[] = [{ '@odata.id': 'Pets(1)', Id: 1, Name: 'Rex' }]
    const { value } = applyODataQuery(data, { select: ['Name'] })
    expect(value).toEqual([{ '@odata.id': 'Pets(1)', Name: 'Rex' }])
  })
})

describe('applyODataQuery — $top / $skip', () => {
  it('$top limits the page size', () => {
    expect(applyODataQuery(pets, { top: 2 }).value.map((p) => p['Id'])).toEqual([1, 2])
  })

  it('$skip drops leading rows', () => {
    expect(applyODataQuery(pets, { skip: 1 }).value.map((p) => p['Id'])).toEqual([2, 3])
  })

  it('$skip + $top compose for a window', () => {
    expect(applyODataQuery(pets, { skip: 1, top: 1 }).value.map((p) => p['Id'])).toEqual([2])
  })
})

describe('applyODataQuery — $count', () => {
  it('returns the post-filter count BEFORE paging', () => {
    const { value, count } = applyODataQuery(pets, {
      filter: "Status eq 'Available'",
      top: 1,
      count: true
    })
    expect(count).toBe(2)
    expect(value.length).toBe(1)
  })

  it('omits count when not requested', () => {
    expect(applyODataQuery(pets, {}).count).toBeUndefined()
  })
})

describe('applyODataQuery — $expand', () => {
  it('expands a to-one navigation property', () => {
    const { value } = applyODataQuery(pets, { filter: 'Id eq 1', expand: 'Category' }, resolver)
    expect(value[0]['Category']).toEqual({ Id: 1, Name: 'Dogs' })
  })

  it('expands a to-many navigation property', () => {
    const { value } = applyODataQuery(pets, { filter: 'Id eq 1', expand: 'Tags' }, resolver)
    expect(value[0]['Tags']).toEqual([
      { Id: 10, Name: 'friendly' },
      { Id: 11, Name: 'large' }
    ])
  })

  it('applies nested options inside an $expand item', () => {
    const { value } = applyODataQuery(
      pets,
      { filter: 'Id eq 1', expand: 'Tags($select=Name;$top=1)' },
      resolver
    )
    expect(value[0]['Tags']).toEqual([{ Name: 'friendly' }])
  })

  it('keeps an expanded nav property even when $select omits it', () => {
    const { value } = applyODataQuery(
      pets,
      { filter: 'Id eq 1', select: ['Name'], expand: 'Category' },
      resolver
    )
    expect(value[0]).toEqual({ Name: 'Rex', Category: { Id: 1, Name: 'Dogs' } })
  })

  it('leaves unknown navigation properties untouched', () => {
    const { value } = applyODataQuery(pets, { filter: 'Id eq 1', expand: 'Unknown' }, resolver)
    expect('Unknown' in value[0]).toBe(false)
  })
})

describe('applyODataQuery — combinations', () => {
  it('$filter + $orderby + $top + $select together', () => {
    const { value } = applyODataQuery(pets, {
      filter: "Status eq 'Available'",
      orderby: 'Age desc',
      top: 1,
      select: ['Name', 'Age']
    })
    expect(value).toEqual([{ Name: 'Rover', Age: 7 }])
  })
})

describe('parsePagingValue', () => {
  it('parses a positive integer', () => {
    expect(parsePagingValue('5')).toBe(5)
  })
  it('treats blank / non-numeric / unresolved template as absent', () => {
    expect(parsePagingValue('')).toBeUndefined()
    expect(parsePagingValue('  ')).toBeUndefined()
    expect(parsePagingValue('{{pageSize}}')).toBeUndefined()
    expect(parsePagingValue(undefined)).toBeUndefined()
  })
})

describe('parseFilter', () => {
  it('throws on a malformed expression', () => {
    expect(() => parseFilter('Name eq')).toThrow()
    expect(() => parseFilter('contains(Name)')).toThrow()
    expect(() => parseFilter('(Name eq 1')).toThrow()
  })

  it('parses a single comparison into a compare node', () => {
    const ast = parseFilter("Name eq 'Rex'")
    expect(ast.kind).toBe('compare')
  })
})
