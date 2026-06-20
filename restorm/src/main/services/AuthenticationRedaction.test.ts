import { describe, it, expect } from 'vitest'
import {
  redactTokensFromBody,
  collectTokenValues,
  redactTokensFromHeaders,
  redactSecretSubstrings,
  collectHandlebarsReferences
} from './AuthenticationRedaction'

const produced = [{ key: 'Authorization', value: 'Bearer {{access_token}}' }]

describe('collectHandlebarsReferences', () => {
  it('extracts dotted variable references', () => {
    expect(collectHandlebarsReferences('Bearer {{data.token}} {{x}}')).toEqual(['data.token', 'x'])
  })

  it('extracts bracket / quoted-segment references', () => {
    expect(collectHandlebarsReferences('{{tokens.[0].value}}')).toEqual(['tokens.0.value'])
    expect(collectHandlebarsReferences("{{data.['x-token']}}")).toEqual(['data.x-token'])
  })

  it('extracts the field path out of a helper call', () => {
    expect(collectHandlebarsReferences('{{json access_token}}')).toEqual(['access_token'])
  })
})

describe('redactTokensFromBody', () => {
  it('redacts the referenced JSON field', () => {
    const out = redactTokensFromBody('{"access_token":"abc123secret","other":"keep"}', produced)
    expect(JSON.parse(out)).toEqual({ access_token: '***', other: 'keep' })
  })

  it('substring-redacts known token values from a NON-JSON body', () => {
    const out = redactTokensFromBody('access_token=abc123secret&scope=read', produced, ['abc123secret'])
    expect(out).toBe('access_token=***&scope=read')
  })

  it('leaves a non-JSON body without known values untouched', () => {
    const out = redactTokensFromBody('plain text', produced)
    expect(out).toBe('plain text')
  })

  it('redacts a token nested in an array element', () => {
    const headers = [{ key: 'Authorization', value: 'Bearer {{tokens.[0].access_token}}' }]
    const out = redactTokensFromBody('{"tokens":[{"access_token":"abc123secret"}]}', headers)
    expect(JSON.parse(out)).toEqual({ tokens: [{ access_token: '***' }] })
  })

  it('descends every array element when the path crosses an array', () => {
    const headers = [{ key: 'Authorization', value: 'Bearer {{items.token}}' }]
    const out = redactTokensFromBody('{"items":[{"token":"aaaa1111"},{"token":"bbbb2222"}]}', headers)
    expect(JSON.parse(out)).toEqual({ items: [{ token: '***' }, { token: '***' }] })
  })

  it('fails safe (whole-body redaction) when a reference is an unmodellable expression', () => {
    const headers = [{ key: 'Authorization', value: 'Bearer {{json (lookup tokens "access")}}' }]
    const out = redactTokensFromBody('{"tokens":{"access":"abc123secret"},"keep":"x"}', headers)
    expect(JSON.parse(out)).toBe('***')
  })
})

describe('collectTokenValues', () => {
  it('returns the resolved token values at the produced-header paths', () => {
    expect(collectTokenValues('{"access_token":"abc123secret"}', produced)).toEqual(['abc123secret'])
  })

  it('ignores too-short / missing values', () => {
    expect(collectTokenValues('{"access_token":"ab"}', produced)).toEqual([])
    expect(collectTokenValues('{}', produced)).toEqual([])
  })
})

describe('redactTokensFromHeaders', () => {
  it('scrubs token values that echo back into response headers', () => {
    const headers = [
      { key: 'Set-Cookie', value: 'session=abc123secret; Path=/' },
      { key: 'X-Other', value: 'safe' }
    ]
    const out = redactTokensFromHeaders(headers, ['abc123secret'])
    expect(out[0].value).toBe('session=***; Path=/')
    expect(out[1].value).toBe('safe')
    // input not mutated
    expect(headers[0].value).toBe('session=abc123secret; Path=/')
  })

  it('returns a copy when there are no secret values', () => {
    const headers = [{ key: 'A', value: 'b' }]
    const out = redactTokensFromHeaders(headers, [])
    expect(out).toEqual(headers)
    expect(out).not.toBe(headers)
  })
})

describe('redactSecretSubstrings', () => {
  it('ignores secrets shorter than 4 chars (avoid mangling common substrings)', () => {
    expect(redactSecretSubstrings('abc xyz', ['ab'])).toBe('abc xyz')
  })
})
