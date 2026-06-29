import { describe, it, expect } from 'vitest'
import {
  resolveChannel,
  functionsBaseUrl,
  functionsHost,
  endpointUrl,
  isBackendFunctionsUrl
} from './backend'

const DEV_HOST = 'ntxmtfngtfevisbylniz.supabase.co'

describe('backend config', () => {
  it('resolves the preview channel from a -preview version suffix', () => {
    expect(resolveChannel('0.1.7-preview')).toBe('preview')
    expect(resolveChannel('1.0.0-preview.3')).toBe('preview')
  })

  it('resolves prod for a clean release version', () => {
    expect(resolveChannel('0.1.7')).toBe('prod')
    expect(resolveChannel('1.2.3')).toBe('prod')
  })

  it('builds endpoint URLs under the channel base', () => {
    const base = functionsBaseUrl('preview')
    expect(endpointUrl('preview', 'login')).toBe(`${base}/login`)
    expect(endpointUrl('preview', 'session')).toBe(`${base}/session`)
    expect(endpointUrl('preview', 'entitlement')).toBe(`${base}/entitlement`)
  })

  it('exposes the exact per-channel project host', () => {
    expect(functionsHost('preview')).toBe(DEV_HOST)
    expect(functionsHost('prod')).toBe('jkfaqkaakovwlsncukif.supabase.co')
  })

  describe('isBackendFunctionsUrl (exact-host firewall guard)', () => {
    it('accepts ONLY the exact allowed project host over https on the functions path', () => {
      expect(isBackendFunctionsUrl(`https://${DEV_HOST}/functions/v1/login`, DEV_HOST)).toBe(true)
      expect(isBackendFunctionsUrl(`https://${DEV_HOST}/functions/v1/entitlement?x=1`, DEV_HOST)).toBe(true)
    })

    it('rejects a DIFFERENT *.supabase.co host (no wildcard exemption)', () => {
      // The core NIT: another Supabase project must NOT get the bypass.
      expect(isBackendFunctionsUrl('https://other-project.supabase.co/functions/v1/login', DEV_HOST)).toBe(false)
      expect(isBackendFunctionsUrl('https://jkfaqkaakovwlsncukif.supabase.co/functions/v1/login', DEV_HOST)).toBe(false)
    })

    it('rejects non-https, foreign hosts, host-suffix spoofs, and non-functions paths', () => {
      expect(isBackendFunctionsUrl(`http://${DEV_HOST}/functions/v1/login`, DEV_HOST)).toBe(false)
      expect(isBackendFunctionsUrl('https://evil.com/functions/v1/login', DEV_HOST)).toBe(false)
      expect(isBackendFunctionsUrl(`https://${DEV_HOST}.evil.com/functions/v1/login`, DEV_HOST)).toBe(false)
      expect(isBackendFunctionsUrl(`https://${DEV_HOST}/rest/v1/users`, DEV_HOST)).toBe(false)
      expect(isBackendFunctionsUrl('not a url', DEV_HOST)).toBe(false)
    })
  })
})
