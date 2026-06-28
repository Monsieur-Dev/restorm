import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void { this.handlers.set(name, handler) }
  registerResource(): void { /* unused */ }
  invoke(name: string, args: Record<string, unknown> = {}): { content: { type: 'text'; text: string }[]; isError?: true } {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {}) as { content: { type: 'text'; text: string }[]; isError?: true }
  }
}

const findByIdSpy = vi.fn<(id: string) => unknown>()
const broadcastSpy = vi.fn<() => void>()
const getAllWindowsSpy = vi.fn<() => unknown[]>(() => [])
const listConfigsSpy = vi.fn<(r: unknown) => unknown>()
const addConfigSpy = vi.fn<(...a: unknown[]) => unknown>()
const updateConfigSpy = vi.fn<(...a: unknown[]) => unknown>()
const deleteConfigSpy = vi.fn<(...a: unknown[]) => unknown>()
const describeSpy = vi.fn<(p?: string) => unknown>()

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => getAllWindowsSpy() } }))
vi.mock('../../services/CollectionStore', () => ({ collectionStore: { findById: (id: string) => findByIdSpy(id) } }))
vi.mock('../../../shared/models', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isRequest: (x: unknown) => !!x && (x as { __req?: boolean }).__req === true
}))
vi.mock('./import', () => ({ broadcastTreeReplace: () => { broadcastSpy() } }))
vi.mock('../quickConfig', () => ({
  listConfigs: (r: unknown) => listConfigsSpy(r),
  addConfig: (...a: unknown[]) => addConfigSpy(...a),
  updateConfig: (...a: unknown[]) => updateConfigSpy(...a),
  deleteConfig: (...a: unknown[]) => deleteConfigSpy(...a),
  describeConfigSchema: (p?: string) => describeSpy(p)
}))

import { registerQuickConfigTools } from './quickConfig'

function parse(res: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
  return JSON.parse(res.content[0]?.text ?? '{}') as Record<string, unknown>
}

const REQ = { id: 'req-1', __req: true }

describe('quick-config MCP tools', () => {
  let mcp: FakeMcpService
  beforeEach(() => {
    findByIdSpy.mockReset().mockImplementation((id) => (id === 'req-1' ? REQ : null))
    broadcastSpy.mockReset()
    getAllWindowsSpy.mockReset().mockImplementation(() => [])
    listConfigsSpy.mockReset(); addConfigSpy.mockReset(); updateConfigSpy.mockReset()
    deleteConfigSpy.mockReset(); describeSpy.mockReset()
    mcp = new FakeMcpService()
    registerQuickConfigTools(mcp as unknown as McpService)
  })

  it('list_quick_configs returns the request configs', () => {
    listConfigsSpy.mockReturnValue([{ id: 'c1', name: 'a', storageTarget: 'project', fields: {} }])
    const res = mcp.invoke('list_quick_configs', { requestId: 'req-1' })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ requestId: 'req-1', configs: [{ id: 'c1', name: 'a', storageTarget: 'project', fields: {} }] })
  })

  it('list_quick_configs errors on an unknown request id', () => {
    const res = mcp.invoke('list_quick_configs', { requestId: 'nope' })
    expect(res.isError).toBe(true)
    expect(listConfigsSpy).not.toHaveBeenCalled()
  })

  it('add_quick_config saves + broadcasts + triggers save on success', () => {
    addConfigSpy.mockReturnValue({ ok: true, config: { id: 'c1', name: 'prod' } })
    const res = mcp.invoke('add_quick_config', { requestId: 'req-1', name: 'prod', fields: { url: 'x' } })
    expect(res.isError).toBeUndefined()
    expect(addConfigSpy).toHaveBeenCalledWith(REQ, 'prod', { url: 'x' })
    expect(parse(res)).toEqual({ id: 'c1', name: 'prod' })
    expect(broadcastSpy).toHaveBeenCalledTimes(1)
    expect(getAllWindowsSpy).toHaveBeenCalled()
  })

  it('add_quick_config maps a validation rejection to an error and does NOT broadcast', () => {
    addConfigSpy.mockReturnValue({ ok: false, error: 'fields [query] are not valid for a http request' })
    const res = mcp.invoke('add_quick_config', { requestId: 'req-1', name: 'bad', storageTarget: 'project', fields: { query: 'q' } })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('not valid for a http')
    expect(broadcastSpy).not.toHaveBeenCalled()
  })

  it('delete_quick_config requires a configId', () => {
    const res = mcp.invoke('delete_quick_config', { requestId: 'req-1', configId: '' })
    expect(res.isError).toBe(true)
    expect(deleteConfigSpy).not.toHaveBeenCalled()
  })

  it('describe_quick_config_schema passes the protocol through', () => {
    describeSpy.mockReturnValue({ grpc: ['url', 'service'] })
    const res = mcp.invoke('describe_quick_config_schema', { protocol: 'grpc' })
    expect(describeSpy).toHaveBeenCalledWith('grpc')
    expect(parse(res)).toEqual({ schema: { grpc: ['url', 'service'] } })
  })
})
