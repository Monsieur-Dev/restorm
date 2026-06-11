import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpResourceConfig, McpResourceHandler } from 'electron-core-ui'

const mockState = {
  findById: vi.fn<(id: string) => unknown>(),
  getCollections: vi.fn<() => unknown[]>(),
  serializeRequest: vi.fn<(r: unknown) => Record<string, unknown>>(),
  fileServiceState: vi.fn<() => { currentFile: { path: string | null; name: string | null; isDirty: boolean } }>()
}

vi.mock('../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => mockState.findById(id),
    getCollections: () => mockState.getCollections(),
    serializeRequest: (r: unknown) => mockState.serializeRequest(r)
  }
}))

vi.mock('electron-core-ui/main', () => ({
  getFileService: () => ({
    getState: () => mockState.fileServiceState()
  })
}))

vi.mock('./tools/activeState', () => ({
  getCurrentTabSnapshot: () => ({ tabId: 'tab-1', itemId: 'item-1', kind: 'request' as const })
}))

import { registerResources } from './resources'

function readJson(text: string | undefined): unknown {
  if (text === undefined) throw new Error('expected text payload')
  return JSON.parse(text)
}

class FakeMcpService {
  private resources = new Map<string, { uri: string; handler: McpResourceHandler }>()
  registerTool(): void { /* not used here */ }
  registerResource(name: string, uri: string, _config: McpResourceConfig, handler: McpResourceHandler): void {
    this.resources.set(name, { uri, handler })
  }
  async readBy(uri: string): Promise<{ text?: string; blob?: string; mimeType?: string }> {
    for (const { uri: registeredUri, handler } of this.resources.values()) {
      if (registeredUri === uri || registeredUri.includes('{')) {
        // Templated URIs we'll match by prefix.
        const prefix = registeredUri.split('{')[0] ?? ''
        if (uri.startsWith(prefix) || registeredUri === uri) {
          return await handler(new URL(uri))
        }
      }
    }
    throw new Error(`no handler for ${uri}`)
  }
}

beforeEach(() => {
  for (const fn of Object.values(mockState)) fn.mockReset()
})

describe('resources — restorm://project', () => {
  it('returns the open file metadata + collection count', async () => {
    mockState.fileServiceState.mockReturnValue({
      currentFile: { path: '/tmp/demo.restorm', name: 'demo.restorm', isDirty: true }
    })
    mockState.getCollections.mockReturnValue([
      { id: 'r', name: 'root', folderType: 'environment', fileFormatVersion: 2, configuration: {}, items: [], environments: [] }
    ])
    const mcp = new FakeMcpService()
    registerResources(mcp as unknown as McpService)
    const { text, mimeType } = await mcp.readBy('restorm://project')
    expect(mimeType).toBe('application/json')
    expect(readJson(text)).toEqual({
      path: '/tmp/demo.restorm',
      name: 'demo.restorm',
      isDirty: true,
      fileFormatVersion: 2,
      collectionCount: 1
    })
  })

  it('handles the no-open-project state', async () => {
    mockState.fileServiceState.mockReturnValue({
      currentFile: { path: null, name: null, isDirty: false }
    })
    mockState.getCollections.mockReturnValue([])
    const mcp = new FakeMcpService()
    registerResources(mcp as unknown as McpService)
    const { text } = await mcp.readBy('restorm://project')
    expect(readJson(text)).toEqual({
      path: null, name: null, isDirty: false, fileFormatVersion: null, collectionCount: 0
    })
  })
})

describe('resources — restorm://tree', () => {
  it('serialises the hierarchical id+name tree', async () => {
    mockState.getCollections.mockReturnValue([{
      id: 'root', name: 'Root', folderType: 'environment',
      configuration: {}, environments: [],
      items: [
        { id: 'leaf', name: 'leaf', type: 'http' }
      ]
    }])
    const mcp = new FakeMcpService()
    registerResources(mcp as unknown as McpService)
    const { text } = await mcp.readBy('restorm://tree')
    expect(readJson(text)).toEqual([
      {
        id: 'root', name: 'Root', kind: 'env-folder',
        children: [{ id: 'leaf', name: 'leaf', kind: 'request', protocol: 'http' }]
      }
    ])
  })
})

describe('resources — restorm://active-tab', () => {
  it('mirrors the activeState cache snapshot', async () => {
    const mcp = new FakeMcpService()
    registerResources(mcp as unknown as McpService)
    const { text } = await mcp.readBy('restorm://active-tab')
    expect(readJson(text)).toEqual({ tabId: 'tab-1', itemId: 'item-1', kind: 'request' })
  })
})

describe('resources — restorm://request/{id}', () => {
  it('returns the masked-secret request payload for a known id', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    mockState.serializeRequest.mockReturnValue({
      id: 'r1', name: 'r1', type: 'http',
      headers: [{ key: 'Authorization', value: { type: 'secret', source: 'envFileSecret', params: {} } }]
    })
    const mcp = new FakeMcpService()
    registerResources(mcp as unknown as McpService)
    const { text } = await mcp.readBy('restorm://request/r1')
    const parsed = readJson(text)
    expect(parsed).toMatchObject({
      headers: [{ key: 'Authorization', value: { type: 'secret', source: 'envFileSecret', params: {} } }]
    })
    expect(JSON.stringify(parsed)).not.toContain('plaintext-secret')
  })

  it('returns a structured error JSON for an unknown id', async () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerResources(mcp as unknown as McpService)
    const { text } = await mcp.readBy('restorm://request/ghost')
    expect(readJson(text)).toEqual({ error: 'No request with id ghost' })
  })

  it('returns a structured error JSON when target is not a request', async () => {
    mockState.findById.mockReturnValue({ id: 'f', name: 'f', configuration: {}, items: [] })
    const mcp = new FakeMcpService()
    registerResources(mcp as unknown as McpService)
    const { text } = await mcp.readBy('restorm://request/f')
    expect(readJson(text)).toEqual({ error: 'No request with id f' })
  })
})
