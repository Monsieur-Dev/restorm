// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveTemplate } from '../../../main/services/request/resolveTemplate'

/** Resolution goes through the real shared resolver (which registers helpers),
 * so this also proves the dynamic vars work on every path that uses it
 * (normal Send + scenario httpRequest). */
describe('Postman dynamic variables via {{$...}}', () => {
  it('resolves {{$guid}} / {{$randomUUID}} to a UUID', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    expect(resolveTemplate('{{$guid}}', {})).toMatch(uuid)
    expect(resolveTemplate('{{$randomUUID}}', {})).toMatch(uuid)
  })

  it('resolves {{$timestamp}} to unix seconds and {{$isoTimestamp}} to an ISO date', () => {
    expect(resolveTemplate('{{$timestamp}}', {})).toMatch(/^\d{10}$/)
    expect(resolveTemplate('{{$isoTimestamp}}', {})).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('resolves {{$randomInt}} to 0..1000', () => {
    const n = Number(resolveTemplate('{{$randomInt}}', {}))
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBeGreaterThanOrEqual(0)
    expect(n).toBeLessThanOrEqual(1000)
  })

  it('resolves {{$randomAlphaNumeric}} to a non-empty alphanumeric string', () => {
    expect(resolveTemplate('{{$randomAlphaNumeric}}', {})).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('resolves faker-style vars to non-empty values', () => {
    expect(resolveTemplate('{{$randomFirstName}}', {})).not.toBe('')
    expect(resolveTemplate('{{$randomEmail}}', {})).toMatch(/@/)
    expect(resolveTemplate('{{$randomBoolean}}', {})).toMatch(/^(true|false)$/)
    expect(resolveTemplate('{{$randomIP}}', {})).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/)
  })

  it('resolves dynamic vars embedded inside a larger template + keeps real context vars', () => {
    const out = resolveTemplate('{{baseUrl}}/pets/{{$guid}}?ts={{$timestamp}}', { baseUrl: 'http://api.test' })
    expect(out).toMatch(/^http:\/\/api\.test\/pets\/[0-9a-f-]{36}\?ts=\d{10}$/)
  })

  it('leaves an unknown {{$randomNope}} unresolved (renders empty, no throw)', () => {
    expect(resolveTemplate('x{{$randomNope}}y', {})).toBe('xy')
  })
})
