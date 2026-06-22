import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

// The PNG bytes the mocked `capturePage().toPNG()` returns. Asserted round-trip
// through the temp file + the resource handler's base64 blob.
const PNG_BYTES = Buffer.from('fake-png-payload-bytes')

const fakeWindow = {
  isDestroyed: () => false,
  isVisible: () => true,
  webContents: {
    id: 1,
    capturePage: vi.fn(() => Promise.resolve({ toPNG: () => PNG_BYTES }))
  }
}

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [fakeWindow],
    getFocusedWindow: () => fakeWindow
  },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  protocol: { handle: vi.fn() },
  net: { fetch: vi.fn() }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { McpService, SCREENSHOT_MEDIA_URL_PREFIX } from './McpService'

interface ResourceLinkPart { type: 'resource_link'; uri: string; mimeType?: string }
interface ToolResult { content: Record<string, unknown>[] }

/** Reach the private resource registry to invoke a resource handler directly. */
function readResource(service: McpService, uri: string): { text?: string; blob?: string; mimeType?: string } {
  const resources = (service as unknown as {
    resources: { name: string; handler: (u: URL) => { text?: string; blob?: string; mimeType?: string } }[]
  }).resources
  const screenshotResource = resources.find((r) => r.name === 'screenshot')
  if (!screenshotResource) throw new Error('screenshot resource not registered')
  return screenshotResource.handler(new URL(uri))
}

describe('McpService screenshot — on-demand resource serving', () => {
  let service: McpService
  const written: string[] = []

  beforeEach(() => {
    service = new McpService()
    fakeWindow.webContents.capturePage.mockClear()
  })

  afterEach(async () => {
    for (const p of written.splice(0)) await fs.rm(p, { force: true })
  })

  it('returns a resource_link to an ecui-media screenshot uri and inlines NO base64', async () => {
    const result = (await service.invokeTool('screenshot', {})) as ToolResult

    // No inline image part / base64 in the default tool result.
    expect(result.content.some((c) => c['type'] === 'image')).toBe(false)
    const serialized = JSON.stringify(result)
    expect(serialized.includes(PNG_BYTES.toString('base64'))).toBe(false)

    const link = result.content.find((c) => c['type'] === 'resource_link') as unknown as ResourceLinkPart | undefined
    expect(link).toBeDefined()
    if (!link) throw new Error('no resource_link in screenshot result')
    expect(link.uri.startsWith(SCREENSHOT_MEDIA_URL_PREFIX)).toBe(true)
    expect(link.mimeType).toBe('image/png')

    // The PNG was written to a temp file under tmpdir().
    const name = basename(new URL(link.uri).pathname)
    const filePath = join(tmpdir(), name)
    written.push(filePath)
    expect(await fs.readFile(filePath)).toEqual(PNG_BYTES)
  })

  it('serves the PNG bytes as a base64 blob via the resource handler (resources/read path)', async () => {
    const result = (await service.invokeTool('screenshot', {})) as ToolResult
    const link = result.content.find((c) => c['type'] === 'resource_link') as unknown as ResourceLinkPart
    const filePath = join(tmpdir(), basename(new URL(link.uri).pathname))
    written.push(filePath)

    const read = readResource(service, link.uri)
    expect(read.mimeType).toBe('image/png')
    expect(read.blob).toBe(PNG_BYTES.toString('base64'))
    expect(read.text).toBeUndefined()
  })

  it('rejects a non-screenshot / traversal uri without reading anything off disk', () => {
    const read = readResource(service, 'ecui-media://screenshot/..%2Fetc%2Fpasswd')
    expect(read.blob).toBeUndefined()
    expect(read.text).toContain('not a screenshot resource')
  })

  it('returns a clean gone error for an evicted (missing) screenshot', () => {
    const read = readResource(service, `${SCREENSHOT_MEDIA_URL_PREFIX}ecu-screenshot-does-not-exist.png`)
    expect(read.blob).toBeUndefined()
    expect(read.text).toContain('evicted')
  })
})
