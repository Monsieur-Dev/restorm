/**
 * Unit tests for the OData query-option serializer + URL builder.
 * Pure functions — no electron, no renderer.
 */

import { describe, it, expect } from 'vitest'
import type { KeyValue } from '../../src/shared/types/baseTypes'
import type { ODataQueryOptions } from '../../src/shared/types/collections'
import {
  serializeODataQueryOptions,
  buildODataUrl,
  keyValuesToPairs
} from '../../src/shared/utils/odataQuery'

describe('serializeODataQueryOptions', () => {
  it('returns an empty list when no options are set', () => {
    expect(serializeODataQueryOptions({})).toEqual([])
  })

  it('serializes a single $filter', () => {
    expect(serializeODataQueryOptions({ filter: "Name eq 'Alice'" })).toEqual([
      ['$filter', "Name eq 'Alice'"]
    ])
  })

  it('ignores whitespace-only string values', () => {
    expect(serializeODataQueryOptions({ filter: '   ', top: '', skip: '' })).toEqual([])
  })

  it('emits $select with comma-joined properties, trimmed and empty-filtered', () => {
    expect(serializeODataQueryOptions({ select: ['Id', ' Name ', '', 'Email'] })).toEqual([
      ['$select', 'Id,Name,Email']
    ])
  })

  it('omits $select when the list is empty or only whitespace', () => {
    expect(serializeODataQueryOptions({ select: [] })).toEqual([])
    expect(serializeODataQueryOptions({ select: ['   ', ''] })).toEqual([])
  })

  it('emits $top and $skip as strings (template-friendly)', () => {
    expect(serializeODataQueryOptions({ top: '25', skip: '50' })).toEqual([
      ['$top', '25'],
      ['$skip', '50']
    ])
  })

  it('emits $count=true only when options.count is true (v4)', () => {
    expect(serializeODataQueryOptions({ count: true })).toEqual([['$count', 'true']])
    expect(serializeODataQueryOptions({ count: false })).toEqual([])
    expect(serializeODataQueryOptions({})).toEqual([])
  })

  it('maps $count to $inlinecount=allpages for v2 and v3', () => {
    expect(serializeODataQueryOptions({ count: true }, 'v2')).toEqual([
      ['$inlinecount', 'allpages']
    ])
    expect(serializeODataQueryOptions({ count: true }, 'v3')).toEqual([
      ['$inlinecount', 'allpages']
    ])
  })

  it('emits all options in a canonical v4 order: $filter, $select, $top, $skip, $count', () => {
    const options: ODataQueryOptions = {
      count: true,
      skip: '10',
      top: '25',
      select: ['Id', 'Name'],
      filter: 'IsActive eq true'
    }
    expect(serializeODataQueryOptions(options)).toEqual([
      ['$filter', 'IsActive eq true'],
      ['$select', 'Id,Name'],
      ['$top', '25'],
      ['$skip', '10'],
      ['$count', 'true']
    ])
  })

  it('passes through env-templated values unchanged — substitution is the caller responsibility', () => {
    expect(serializeODataQueryOptions({ filter: "Name eq '{{env.user}}'", top: '{{pageSize}}' })).toEqual([
      ['$filter', "Name eq '{{env.user}}'"],
      ['$top', '{{pageSize}}']
    ])
  })

  describe('advanced options ($expand / $orderby / $search / $format / $apply)', () => {
    it('emits $expand verbatim', () => {
      expect(serializeODataQueryOptions({ expand: 'Category,Tags($select=Name;$top=5)' })).toEqual([
        ['$expand', 'Category,Tags($select=Name;$top=5)']
      ])
    })

    it('emits $orderby verbatim', () => {
      expect(serializeODataQueryOptions({ orderby: 'Name asc,Id desc' })).toEqual([
        ['$orderby', 'Name asc,Id desc']
      ])
    })

    it('emits $search / $format / $apply verbatim', () => {
      expect(serializeODataQueryOptions({ search: 'puppy', format: 'json', apply: 'groupby((Status))' })).toEqual([
        ['$search', 'puppy'],
        ['$format', 'json'],
        ['$apply', 'groupby((Status))']
      ])
    })

    it('omits whitespace-only advanced options', () => {
      expect(serializeODataQueryOptions({ expand: '   ', orderby: '', search: '\t', format: '', apply: '' })).toEqual([])
    })

    it('emits all options in the canonical v4 order', () => {
      const options: ODataQueryOptions = {
        apply: 'groupby((Status))',
        format: 'json',
        search: 'puppy',
        orderby: 'Id desc',
        expand: 'Category',
        count: true,
        skip: '10',
        top: '25',
        select: ['Id', 'Name'],
        filter: 'IsActive eq true'
      }
      expect(serializeODataQueryOptions(options)).toEqual([
        ['$filter', 'IsActive eq true'],
        ['$select', 'Id,Name'],
        ['$expand', 'Category'],
        ['$orderby', 'Id desc'],
        ['$top', '25'],
        ['$skip', '10'],
        ['$count', 'true'],
        ['$search', 'puppy'],
        ['$format', 'json'],
        ['$apply', 'groupby((Status))']
      ])
    })
  })
})

describe('buildODataUrl', () => {
  it('returns the base URL untouched when there are no pairs', () => {
    expect(buildODataUrl('https://api.example.com/odata/People', [], [])).toBe(
      'https://api.example.com/odata/People'
    )
  })

  it('appends `?` and encodes values when the base has no query string', () => {
    expect(
      buildODataUrl('https://api.example.com/odata/People', [['$filter', "Name eq 'Al & Bob'"]], [])
    ).toBe(
      "https://api.example.com/odata/People?$filter=Name%20eq%20'Al%20%26%20Bob'"
    )
  })

  it('keeps `$` literal in system-option keys (not percent-encoded)', () => {
    const url = buildODataUrl('https://x/People', [['$top', '25'], ['$count', 'true']], [])
    expect(url).toContain('$top=25')
    expect(url).toContain('$count=true')
    expect(url).not.toContain('%24')
  })

  it('uses `&` when the base already has a query string', () => {
    expect(
      buildODataUrl('https://x/People?api-version=2.0', [['$top', '10']], [])
    ).toBe('https://x/People?api-version=2.0&$top=10')
  })

  it('encodes both key and value for non-OData extra params', () => {
    expect(
      buildODataUrl('https://x/People', [], [['api key', 'a b&c']])
    ).toBe('https://x/People?api%20key=a%20b%26c')
  })

  it('emits system options before extra params (deterministic ordering)', () => {
    const url = buildODataUrl(
      'https://x/People',
      [['$top', '10']],
      [['apiKey', 'secret']]
    )
    expect(url).toBe('https://x/People?$top=10&apiKey=secret')
  })
})

describe('keyValuesToPairs', () => {
  const kv = (key: string, value: string, enabled?: boolean): KeyValue =>
    enabled === undefined ? { key, value } : { key, value, enabled }

  it('returns [] for an empty list', () => {
    expect(keyValuesToPairs([])).toEqual([])
  })

  it('drops entries explicitly disabled', () => {
    expect(keyValuesToPairs([kv('a', '1', false), kv('b', '2', true)])).toEqual([['b', '2']])
  })

  it('keeps entries where `enabled` is undefined (= on by default)', () => {
    expect(keyValuesToPairs([kv('a', '1')])).toEqual([['a', '1']])
  })

  it('drops entries with blank or whitespace-only keys', () => {
    expect(keyValuesToPairs([kv('', 'x'), kv('   ', 'y'), kv('ok', 'z')])).toEqual([['ok', 'z']])
  })

  it('coerces non-string values via String()', () => {
    expect(keyValuesToPairs([{ key: 'n', value: 42 as unknown as string }])).toEqual([['n', '42']])
  })

  it('trims the key but preserves the value verbatim', () => {
    expect(keyValuesToPairs([{ key: '  apiKey  ', value: '  secret  ' }])).toEqual([
      ['apiKey', '  secret  ']
    ])
  })
})
