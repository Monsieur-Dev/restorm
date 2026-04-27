import { describe, it, expect } from 'vitest'
import { isCurlText, parseCurlCommand } from '../../src/shared/utils/parseCurlCommand'

describe('isCurlText', () => {
  it('returns true for a leading-curl string', () => {
    expect(isCurlText('curl https://example.com')).toBe(true)
    expect(isCurlText('  curl https://example.com  ')).toBe(true)
  })

  it('returns true for `curl <space>` on the first line of a multi-line snippet', () => {
    expect(isCurlText('curl https://example.com \\\n  -H "X: 1"')).toBe(true)
  })

  it('returns false for non-curl strings', () => {
    expect(isCurlText('https://example.com')).toBe(false)
    expect(isCurlText('curlx https://example.com')).toBe(false)
    expect(isCurlText('')).toBe(false)
  })
})

describe('parseCurlCommand', () => {
  it('parses a minimal GET', () => {
    const r = parseCurlCommand('curl https://api.example.com/pet/42')
    expect(r).not.toBeNull()
    expect(r?.method).toBe('GET')
    expect(r?.url).toBe('https://api.example.com/pet/42')
    expect(r?.headers).toEqual([])
    expect(r?.params).toEqual([])
    expect(r?.body).toBeUndefined()
  })

  it('parses `-X POST` and `-H` headers', () => {
    const r = parseCurlCommand(`curl -X POST https://api.example.com/pet -H "Content-Type: application/json" -H "Accept: application/json"`)
    expect(r?.method).toBe('POST')
    expect(r?.headers).toHaveLength(2)
    expect(r?.headers[0]?.key).toBe('Content-Type')
    expect(r?.headers[0]?.value.toString()).toBe('application/json')
  })

  it('infers POST when `-d` is present without `-X`', () => {
    const r = parseCurlCommand(`curl https://api.example.com/pet -d '{"name":"rex"}'`)
    expect(r?.method).toBe('POST')
    expect(r?.body?.type).toBe('text')
    if (r?.body?.type === 'text') expect(r.body.content).toBe('{"name":"rex"}')
  })

  it('parses `-F` form-data fields into a multipart body', () => {
    const r = parseCurlCommand(`curl https://api.example.com/pet -F 'name=rex' -F 'tag=dog'`)
    expect(r?.body?.type).toBe('form-data')
    if (r?.body?.type === 'form-data') {
      expect(r.body.fields).toHaveLength(2)
      expect(r.body.fields[0]?.key).toBe('name')
    }
  })

  it('extracts query params from the URL', () => {
    const r = parseCurlCommand(`curl 'https://api.example.com/pet?status=available&limit=10'`)
    expect(r?.url).toBe('https://api.example.com/pet')
    const keys = r?.params.map((p) => p.key)
    expect(keys).toEqual(['status', 'limit'])
  })

  it('handles backslash line continuations (multi-line cURL from docs)', () => {
    const r = parseCurlCommand(`curl https://api.example.com/pet \\
  -H 'Authorization: Bearer abc' \\
  -d '{"id":1}'`)
    expect(r).not.toBeNull()
    expect(r?.method).toBe('POST')
    expect(r?.headers[0]?.key).toBe('Authorization')
  })

  it('returns null for non-cURL input', () => {
    expect(parseCurlCommand('https://example.com')).toBeNull()
    expect(parseCurlCommand('echo hi')).toBeNull()
    expect(parseCurlCommand('')).toBeNull()
  })

  it('returns null when no URL is present', () => {
    expect(parseCurlCommand('curl --help')).toBeNull()
  })

  it('parses --location --request POST with the URL after multiple flags', () => {
    const r = parseCurlCommand(`curl --location --request POST 'https://api.example.com/v1/login' \\
  --header 'Content-Type: application/json' \\
  --data-raw '{"user":"alice"}'`)
    expect(r).not.toBeNull()
    expect(r?.method).toBe('POST')
    expect(r?.url).toBe('https://api.example.com/v1/login')
    expect(r?.headers[0]?.key).toBe('Content-Type')
    if (r?.body?.type === 'text') expect(r.body.content).toBe('{"user":"alice"}')
  })

  it('parses double-quoted args containing single quotes inside', () => {
    const r = parseCurlCommand(`curl https://api.example.com -H "X-Note: it's fine" -d "name=O'Brien"`)
    expect(r?.headers[0]?.value.toString()).toBe("it's fine")
    if (r?.body?.type === 'text') expect(r.body.content).toBe("name=O'Brien")
  })
})
