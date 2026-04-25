import { describe, it, expect } from 'vitest'
import {
  collectHandlebarsReferences,
  redactTokensFromBody
} from '../../../src/main/services/AuthenticationRedaction'

describe('collectHandlebarsReferences', () => {
  it('extracts simple variable names', () => {
    expect(collectHandlebarsReferences('{{access_token}}')).toEqual(['access_token'])
  })
  it('extracts dotted paths', () => {
    expect(collectHandlebarsReferences('{{auth.access_token}}')).toEqual(['auth.access_token'])
  })
  it('extracts multiple references from one template', () => {
    expect(collectHandlebarsReferences('{{token_type}} {{access_token}}')).toEqual([
      'token_type',
      'access_token'
    ])
  })
  it('tolerates whitespace inside braces', () => {
    expect(collectHandlebarsReferences('{{  access_token  }}')).toEqual(['access_token'])
  })
  it('returns [] when there are no references', () => {
    expect(collectHandlebarsReferences('Bearer static')).toEqual([])
  })
})

describe('redactTokensFromBody', () => {
  it('redacts every referenced field with "***"', () => {
    const body = JSON.stringify({ access_token: 'abc', expires_in: 3600, token_type: 'Bearer' })
    const producedHeaders = [
      { key: 'Authorization', value: '{{token_type}} {{access_token}}' }
    ]
    const redacted = redactTokensFromBody(body, producedHeaders)
    const parsed = JSON.parse(redacted) as Record<string, unknown>
    expect(parsed.access_token).toBe('***')
    expect(parsed.token_type).toBe('***')
    expect(parsed.expires_in).toBe(3600) // not referenced → untouched
  })

  it('redacts nested paths', () => {
    const body = JSON.stringify({ auth: { token: 'abc', meta: { expires: 5 } } })
    const producedHeaders = [
      { key: 'Authorization', value: 'Bearer {{auth.token}}' }
    ]
    const redacted = redactTokensFromBody(body, producedHeaders)
    const parsed = JSON.parse(redacted) as { auth: { token: string; meta: { expires: number } } }
    expect(parsed.auth.token).toBe('***')
    expect(parsed.auth.meta.expires).toBe(5)
  })

  it('leaves non-JSON bodies unchanged', () => {
    const body = 'plain-text-token'
    const producedHeaders = [{ key: 'Authorization', value: '{{access_token}}' }]
    expect(redactTokensFromBody(body, producedHeaders)).toBe(body)
  })

  it('skips disabled producedHeaders', () => {
    const body = JSON.stringify({ access_token: 'abc', refresh_token: 'def' })
    const producedHeaders = [
      { key: 'Authorization', value: '{{access_token}}', enabled: true },
      { key: 'X-Refresh', value: '{{refresh_token}}', enabled: false }
    ]
    const redacted = redactTokensFromBody(body, producedHeaders)
    const parsed = JSON.parse(redacted) as Record<string, unknown>
    expect(parsed.access_token).toBe('***')
    expect(parsed.refresh_token).toBe('def') // disabled rule → not touched
  })

  it('skips the synthetic `{{body}}` reference used for non-JSON bodies', () => {
    const body = JSON.stringify({ other: 'x' })
    const producedHeaders = [{ key: 'Authorization', value: '{{body}}' }]
    expect(redactTokensFromBody(body, producedHeaders)).toBe(body)
  })

  it('returns empty body unchanged', () => {
    expect(redactTokensFromBody('', [{ key: 'a', value: '{{x}}' }])).toBe('')
  })

  it('is a no-op when no producedHeaders reference anything', () => {
    const body = JSON.stringify({ a: 1 })
    expect(redactTokensFromBody(body, [{ key: 'X', value: 'literal' }])).toBe(body)
  })
})
