import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpService } from 'electron-core-ui'

// create_project hardening: must require an absolute path, verify the parent
// directory exists as a directory, and refuse to overwrite an existing file
// (the `wx` flag). These are security/data-loss guards, so exercise each
// rejection path directly rather than relying on the happy-path e2e.

const statMock = vi.fn<(p: string) => Promise<{ isDirectory: () => boolean }>>()
const writeFileMock = vi.fn<(p: string, data: string, opts: unknown) => Promise<void>>()
const openMock = vi.fn<(p: string) => Promise<{ success: boolean }>>()
let fileServiceReady = true

vi.mock('node:fs', () => {
  const promises = {
    stat: (p: string) => statMock(p),
    writeFile: (p: string, data: string, opts: unknown) => writeFileMock(p, data, opts)
  }
  return { promises, default: { promises } }
})
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('electron-core-ui/main', () => ({
  McpService: vi.fn(),
  isFileServiceInitialized: () => fileServiceReady,
  getFileService: () => ({ open: (p: string) => openMock(p), getRecentFiles: () => [] })
}))
// `project.ts` now also imports `collectionStore` (open_project's
// readiness poll) — that module pulls in `createPubSub` from
// `electron-core-ui/main`, which this file's own mock above doesn't
// provide. None of THESE tests (create_project's filesystem hardening)
// touch collections at all, so stub the whole module out rather than
// widen the electron-core-ui/main mock for an unrelated dependency.
vi.mock('../../services/CollectionStore', () => ({ collectionStore: { findById: vi.fn() } }))

import { registerProjectTools } from './project'

class FakeMcpService {
  private handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>()
  registerTool(name: string, _cfg: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.handlers.set(name, handler)
  }
  invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    const h = this.handlers.get(name)
    if (!h) throw new Error(`tool not registered: ${name}`)
    return h(args)
  }
}

function reply(r: unknown): { isError: boolean; text: string } {
  const x = r as { isError?: boolean; content: { text: string }[] }
  return { isError: x.isError ?? false, text: x.content[0]?.text ?? '' }
}

function makeMcp(): FakeMcpService {
  const mcp = new FakeMcpService()
  registerProjectTools(mcp as unknown as McpService)
  return mcp
}

describe('create_project security guards', () => {
  beforeEach(() => {
    statMock.mockReset()
    writeFileMock.mockReset()
    openMock.mockReset()
    fileServiceReady = true
    statMock.mockResolvedValue({ isDirectory: () => true })
    writeFileMock.mockResolvedValue(undefined)
    openMock.mockResolvedValue({ success: true })
  })

  it('rejects a relative filePath without touching the filesystem', async () => {
    const r = reply(await makeMcp().invoke('create_project', { filePath: 'relative/project.restorm' }))
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/absolute path/)
    expect(statMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rejects when the parent directory does not exist', async () => {
    statMock.mockRejectedValue(new Error('ENOENT'))
    const r = reply(await makeMcp().invoke('create_project', { filePath: '/abs/missing/project.restorm' }))
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/Parent directory does not exist/)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rejects when the parent path is not a directory', async () => {
    statMock.mockResolvedValue({ isDirectory: () => false })
    const r = reply(await makeMcp().invoke('create_project', { filePath: '/abs/file-not-dir/project.restorm' }))
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/not a directory/)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('refuses to overwrite an existing file (EEXIST from the wx flag)', async () => {
    const err = Object.assign(new Error('file exists'), { code: 'EEXIST' })
    writeFileMock.mockRejectedValue(err)
    const r = reply(await makeMcp().invoke('create_project', { filePath: '/abs/dir/existing.restorm' }))
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/refusing to overwrite/i)
  })

  it('writes with the wx flag and opens the project on the happy path', async () => {
    const r = reply(await makeMcp().invoke('create_project', { filePath: '/abs/dir/new.restorm' }))
    expect(r.isError).toBe(false)
    expect(writeFileMock).toHaveBeenCalledWith('/abs/dir/new.restorm', '{"fileFormatVersion":1,"collections":[]}', { encoding: 'utf8', flag: 'wx' })
    expect(openMock).toHaveBeenCalledWith('/abs/dir/new.restorm')
  })

  it('appends the .restorm extension when missing (still absolute)', async () => {
    await makeMcp().invoke('create_project', { filePath: '/abs/dir/noext' })
    expect(writeFileMock).toHaveBeenCalledWith('/abs/dir/noext.restorm', '{"fileFormatVersion":1,"collections":[]}', { encoding: 'utf8', flag: 'wx' })
  })
})
