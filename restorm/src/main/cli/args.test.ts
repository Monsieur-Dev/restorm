import { describe, it, expect, afterEach, vi } from 'vitest'

// args.ts imports `app` (electron) + `logger` (electron-core-ui) at module
// load; stub both so importing the module under test is side-effect-free.
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.0-test', getPath: () => '/tmp' }
}))
vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { resolveMcpSessionName } from './args'

describe('resolveMcpSessionName', () => {
  const ORIGINAL_ENV = process.env['RESTORM_MCP_SESSION_NAME']

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env['RESTORM_MCP_SESSION_NAME']
    else process.env['RESTORM_MCP_SESSION_NAME'] = ORIGINAL_ENV
  })

  it('uses the explicit flag verbatim (spaces allowed)', () => {
    expect(resolveMcpSessionName('Named MCP session A', undefined)).toBe('Named MCP session A')
  })

  it('trims the flag value', () => {
    expect(resolveMcpSessionName('  my session  ', undefined)).toBe('my session')
  })

  it('falls back to the env var when no flag', () => {
    process.env['RESTORM_MCP_SESSION_NAME'] = 'env-session'
    expect(resolveMcpSessionName(undefined, undefined)).toBe('env-session')
  })

  it('prefers the flag over the env var', () => {
    process.env['RESTORM_MCP_SESSION_NAME'] = 'env-session'
    expect(resolveMcpSessionName('flag-session', undefined)).toBe('flag-session')
  })

  it('derives a name from the open target basename (extension stripped), pid-suffixed for uniqueness', () => {
    delete process.env['RESTORM_MCP_SESSION_NAME']
    expect(resolveMcpSessionName(undefined, '/home/me/Projects/petstore.restorm')).toBe(`restorm:petstore (${String(process.pid)})`)
  })

  it('handles an open target with a trailing slash (a folder)', () => {
    delete process.env['RESTORM_MCP_SESSION_NAME']
    expect(resolveMcpSessionName(undefined, '/home/me/Projects/MyApi/')).toBe(`restorm:MyApi (${String(process.pid)})`)
  })

  it('falls back to a stable pid-derived id when nothing else is available', () => {
    delete process.env['RESTORM_MCP_SESSION_NAME']
    expect(resolveMcpSessionName(undefined, undefined)).toBe(`restorm-${String(process.pid)}`)
  })

  it('treats an empty flag as absent', () => {
    delete process.env['RESTORM_MCP_SESSION_NAME']
    expect(resolveMcpSessionName('   ', undefined)).toBe(`restorm-${String(process.pid)}`)
  })
})
