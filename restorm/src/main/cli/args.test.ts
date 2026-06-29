import { describe, it, expect, afterEach, vi } from 'vitest'

// `vi.mock` calls are hoisted to the top of the file by vitest; any factory
// variables they reference must also be hoisted via `vi.hoisted` so they are
// defined before the hoisted mock block runs.
const mocks = vi.hoisted(() => ({
  readAllInstancesIncludingCut: vi.fn(() => [] as { pid: number; name: string; projectPath: string | null; startedAt: string; mcpActive: boolean }[]),
  resolveMcpDiscoveryDir: vi.fn((_: string, __?: string) => '/tmp/restorm-mcp-test'),
  // Deterministic generator: always returns 'lucky-unicorn' by default so tests are stable.
  generateUniqueSessionName: vi.fn((_existing: string[], _suffix?: string) => 'lucky-unicorn'),
}))

// args.ts imports `app` (electron) + several symbols from `electron-core-ui`;
// stub them so importing the module under test is side-effect-free.
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.0-test', getPath: () => '/tmp' }
}))
vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  readAllInstancesIncludingCut: mocks.readAllInstancesIncludingCut,
  resolveMcpDiscoveryDir: mocks.resolveMcpDiscoveryDir,
  generateUniqueSessionName: mocks.generateUniqueSessionName,
}))

import { resolveMcpSessionName } from './args'

describe('resolveMcpSessionName', () => {
  const ORIGINAL_ENV = process.env['RESTORM_MCP_SESSION_NAME']

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env['RESTORM_MCP_SESSION_NAME']
    else process.env['RESTORM_MCP_SESSION_NAME'] = ORIGINAL_ENV
    vi.clearAllMocks()
    // Restore default mock implementations after clearAllMocks resets them.
    mocks.generateUniqueSessionName.mockImplementation(() => 'lucky-unicorn')
    mocks.readAllInstancesIncludingCut.mockImplementation(() => [])
    mocks.resolveMcpDiscoveryDir.mockImplementation(() => '/tmp/restorm-mcp-test')
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

  it('generates a friendly random name when nothing else is available', () => {
    delete process.env['RESTORM_MCP_SESSION_NAME']
    // mocks.generateUniqueSessionName returns 'lucky-unicorn' by default.
    expect(resolveMcpSessionName(undefined, undefined)).toBe('lucky-unicorn')
  })

  it('treats an empty flag as absent and generates a friendly name', () => {
    delete process.env['RESTORM_MCP_SESSION_NAME']
    expect(resolveMcpSessionName('   ', undefined)).toBe('lucky-unicorn')
  })

  it('in DEV mode passes the git worktree root basename as the suffix (not the sub-package cwd)', () => {
    // The mock app has isPackaged=false → isDev=true.
    // Inject a resolver that returns a known worktree name and verify it
    // reaches generateUniqueSessionName as the suffix.
    delete process.env['RESTORM_MCP_SESSION_NAME']
    resolveMcpSessionName(undefined, undefined, () => 'my-feature')
    expect(mocks.generateUniqueSessionName).toHaveBeenCalledWith(
      expect.any(Array),
      'my-feature'
    )
  })

  it('falls back to basename(cwd) when git rev-parse fails in DEV mode', () => {
    // Inject a resolver that simulates the catch branch returning basename(cwd).
    delete process.env['RESTORM_MCP_SESSION_NAME']
    resolveMcpSessionName(undefined, undefined, () => 'some-cwd-basename')
    const call = mocks.generateUniqueSessionName.mock.calls[0]
    expect(call).toBeDefined()
    expect(call?.[1]).toBe('some-cwd-basename')
  })

  it('passes existing instance names to the generator for collision avoidance', () => {
    delete process.env['RESTORM_MCP_SESSION_NAME']
    mocks.readAllInstancesIncludingCut.mockReturnValueOnce([
      { pid: 42, name: 'lucky-unicorn', projectPath: null, startedAt: '', mcpActive: true }
    ])
    mocks.generateUniqueSessionName.mockReturnValueOnce('brave-panda')
    const result = resolveMcpSessionName(undefined, undefined)
    expect(result).toBe('brave-panda')
    expect(mocks.generateUniqueSessionName).toHaveBeenCalledWith(['lucky-unicorn'], expect.anything())
  })
})
