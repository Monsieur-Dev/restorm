/**
 * Unit tests for import_from_url tool: headers parameter
 * integration tests via FakeMcpService + mocked importFrom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpToolConfig, McpToolHandler } from 'electron-core-ui'

// FakeMcpService captures registered tool handlers
class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  registerResource(): void { /* unused */ }
  invoke(name: string, args: Record<string, unknown> = {}): unknown {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {})
  }
}

const mockState = {
  importFrom: vi.fn(),
  findById: vi.fn()
}

// Mock the dependencies (factories are hoisted, use mockState object)
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: () => undefined }
    }]
  }
}))

vi.mock('../../src/main/services/import/ImportManager', () => ({
  importFrom: (url: string, opts: Record<string, unknown>) => mockState.importFrom(url, opts) as unknown
}))

vi.mock('../../src/main/services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => mockState.findById(id) as unknown
  },
  pubsub: {
    publish: () => undefined
  },
  PUBSUB_TOPICS: {
    ENVIRONMENT_CREATED: 'env-created'
  }
}))

vi.mock('electron-core-ui/main', () => ({
  eventBusService: {
    emit: () => Promise.resolve()
  }
}))

vi.mock('../../src/main/services/DocumentEvents', () => ({
  DocumentEvents: {
    ENVIRONMENT_CREATED: 'env-created'
  }
}))

vi.mock('../../src/main/utils/urlSecurity', () => ({
  assertSafeFetchUrl: () => undefined
}))

import { registerImportTools } from '../../src/main/mcp/tools/import'

describe('import_from_url tool', () => {
  let fakeService: FakeMcpService

  beforeEach(() => {
    fakeService = new FakeMcpService()
    vi.clearAllMocks()
    mockState.importFrom.mockResolvedValue({
      success: true,
      items: []
    })
    mockState.findById.mockReturnValue(null)
  })

  it('should invoke importFrom with extraHeaders when headers provided', async () => {
    registerImportTools(fakeService as unknown as Parameters<typeof registerImportTools>[0])

    const result = await fakeService.invoke('import_from_url', {
      url: 'https://example.com/swagger.json',
      headers: { Authorization: 'Bearer secret-token', 'X-Custom': 'custom-value' }
    })

    expect(mockState.importFrom).toHaveBeenCalledWith('https://example.com/swagger.json', {
      dryRun: false,
      extraHeaders: { Authorization: 'Bearer secret-token', 'X-Custom': 'custom-value' }
    })
    expect(result).toBeDefined()
  })

  it('should invoke importFrom with undefined extraHeaders when headers omitted', async () => {
    registerImportTools(fakeService as unknown as Parameters<typeof registerImportTools>[0])

    const result = await fakeService.invoke('import_from_url', {
      url: 'https://example.com/swagger.json'
    })

    expect(mockState.importFrom).toHaveBeenCalledWith('https://example.com/swagger.json', {
      dryRun: false,
      extraHeaders: undefined
    })
    expect(result).toBeDefined()
  })

  it('should handle importFrom error and return error reply', async () => {
    registerImportTools(fakeService as unknown as Parameters<typeof registerImportTools>[0])
    mockState.importFrom.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
      statusCode: 401
    })

    const result = await fakeService.invoke('import_from_url', {
      url: 'https://example.com/swagger.json',
      headers: { Authorization: 'Bearer invalid' }
    }) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('HTTP 401')
  })
})
