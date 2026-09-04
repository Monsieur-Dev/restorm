/**
 * The two route-parameter MCP tools (`set_design_route_param` /
 * `delete_design_route_param`) carry non-trivial inline logic — enum-ref ↔
 * inline-values mutual exclusion, array typing, and paramEnumRefs cleanup on
 * delete — that had no coverage. Handlers are invoked directly against a
 * hand-built design (the store is mocked) so we assert the mutation shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'
import type { ApiDesign } from '../../../shared/types/apiDesign'
import type { ParameterDocumentation } from '../../../shared/types/apiDocumentation'

interface ToolResult { content: { type: 'text'; text: string }[]; isError?: boolean }

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  readonly configs = new Map<string, McpToolConfig>()
  registerTool(name: string, config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
    this.configs.set(name, config)
  }
  registerResource(): void { /* unused here */ }
  invoke(name: string, args: Record<string, unknown> = {}): ToolResult {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {} as never) as ToolResult
  }
}

const mockState: { design: ApiDesign | null } = { design: null }

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => (mockState.design !== null && mockState.design.id === id ? mockState.design : null),
    notifyDesignUpdated: () => { /* noop */ },
    getCollections: () => (mockState.design !== null ? [mockState.design] : [])
  }
}))
vi.mock('../../services/DesignServerService', () => ({ designServerService: { isListening: () => false } }))
vi.mock('../../services/designCodegen/DesignCodegenService', () => ({ designCodegenService: { discard: () => { /* noop */ } } }))
vi.mock('./import', () => ({ broadcastTreeReplace: () => { /* noop */ } }))

function parse(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function buildDesign(): ApiDesign {
  return {
    type: 'design',
    id: 'd1',
    name: 'D',
    info: { title: 'D', version: '1.0.0' },
    models: [],
    enums: [{ id: 'enum-status', doc: { name: 'Status', properties: [], enumValues: ['open', 'closed'] } }],
    routeGroups: [{
      id: 'g1',
      doc: { name: 'Orders' },
      routes: [{ id: 'r1', doc: { match: { method: 'GET', urlPattern: '/orders' }, summary: 'List orders' } }]
    }]
  }
}

describe('set/delete_design_route_param MCP tools', () => {
  let mcp: FakeMcpService
  const route = (): ApiDesign['routeGroups'][number]['routes'][number] => {
    const r = mockState.design?.routeGroups[0]?.routes[0]
    if (r === undefined) throw new Error('route missing')
    return r
  }
  const param = (name: string): ParameterDocumentation | undefined => route().doc.parameters?.find((p) => p.name === name)

  beforeEach(async () => {
    mockState.design = buildDesign()
    mcp = new FakeMcpService()
    const { registerDesignTools } = await import('./design')
    registerDesignTools(mcp as unknown as McpService)
  })

  it('creates a query param that references a named enum', () => {
    const res = parse(mcp.invoke('set_design_route_param', { designId: 'd1', route: 'r1', name: 'status', in: 'query', enumRef: 'Status' }))
    expect(res.created).toBe(true)
    expect(param('status')?.location).toBe('query')
    expect(route().design?.paramEnumRefs?.status).toBe('enum-status')
  })

  it('setting inline enumValues drops the named-enum reference', () => {
    mcp.invoke('set_design_route_param', { designId: 'd1', route: 'r1', name: 'status', enumRef: 'Status' })
    mcp.invoke('set_design_route_param', { designId: 'd1', route: 'r1', name: 'status', enumValues: ['a', 'b'] })
    expect(param('status')?.enumValues).toEqual(['a', 'b'])
    expect(route().design?.paramEnumRefs?.status).toBeUndefined()
  })

  it('types a param as an array', () => {
    mcp.invoke('set_design_route_param', { designId: 'd1', route: 'r1', name: 'tags', type: 'array<string>' })
    expect(param('tags')?.type).toBe('array<string>')
  })

  it('an empty enumRef clears the reference', () => {
    mcp.invoke('set_design_route_param', { designId: 'd1', route: 'r1', name: 'status', enumRef: 'Status' })
    mcp.invoke('set_design_route_param', { designId: 'd1', route: 'r1', name: 'status', enumRef: '' })
    expect(route().design?.paramEnumRefs?.status).toBeUndefined()
  })

  it('delete removes the param and its enum ref', () => {
    mcp.invoke('set_design_route_param', { designId: 'd1', route: 'r1', name: 'status', enumRef: 'Status' })
    mcp.invoke('delete_design_route_param', { designId: 'd1', route: 'r1', name: 'status' })
    expect(param('status')).toBeUndefined()
    expect(route().design?.paramEnumRefs).toBeUndefined()
  })
})
