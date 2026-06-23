/**
 * Unit tests for ODataMockServerService's bring-up guards + lifecycle, with the
 * shared HTTP PortHost (WebSocketExecutionService) mocked out. The end-to-end
 * serving behaviour is covered by tests/integration/odataServer.integration.test.ts;
 * this file pins the failure modes (missing CSDL / bad port) + the listen/stop
 * bookkeeping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../../shared/utils/odataServerQuery', async () => {
  const actual = await vi.importActual('../../shared/utils/odataServerQuery')
  return actual
})

const { listenHttpServer, disconnect, getRequestContext } = vi.hoisted(() => ({
  listenHttpServer: vi.fn<(input: { method: string; path: string; matchPrefix?: boolean }) => Promise<{ success: boolean; listening: boolean; error?: string }>>(),
  disconnect: vi.fn<(requestId: string) => boolean>(() => true),
  getRequestContext: vi.fn<(requestId: string) => { fullData: Record<string, unknown> } | undefined>()
}))
vi.mock('./WebSocketExecutionService', () => ({
  websocketExecutionService: { listenHttpServer, disconnect }
}))
vi.mock('./ContextService', () => ({
  contextService: { getRequestContext }
}))

import { odataMockServerService } from './ODataMockServerService'

const VALID_METADATA = `<?xml version="1.0"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="T" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Pet"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.Int32"/></EntityType>
      <EntityContainer Name="C"><EntitySet Name="Pets" EntityType="T.Pet"/></EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`

function mockRequest(over: Record<string, unknown>): void {
  getRequestContext.mockReturnValue({
    fullData: { type: 'odata', server: true, url: 'localhost:8081/odata', mockMetadata: VALID_METADATA, mockData: { Pets: [] }, ...over }
  })
}

describe('ODataMockServerService.listen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listenHttpServer.mockResolvedValue({ success: true, listening: true })
  })
  afterEach(() => { odataMockServerService.closeAll() })

  it('registers a single `*`-method prefix route under the service root', async () => {
    mockRequest({})
    const res = await odataMockServerService.listen('r1')
    expect(res.listening).toBe(true)
    expect(listenHttpServer).toHaveBeenCalledTimes(1)
    const arg = listenHttpServer.mock.calls[0][0] as { method: string; path: string; matchPrefix: boolean }
    expect(arg.method).toBe('*')
    expect(arg.path).toBe('/odata')
    expect(arg.matchPrefix).toBe(true)
    expect(odataMockServerService.isListening('r1')).toBe(true)
  })

  it('fails when the request has no $metadata CSDL', async () => {
    mockRequest({ mockMetadata: '' })
    const res = await odataMockServerService.listen('r2')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/metadata/i)
    expect(listenHttpServer).not.toHaveBeenCalled()
    expect(odataMockServerService.isListening('r2')).toBe(false)
  })

  it('fails when the URL has no valid port', async () => {
    mockRequest({ url: 'localhost/odata' })
    const res = await odataMockServerService.listen('r3')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/port/i)
  })

  it('is idempotent — a second listen on a hosting request is a no-op success', async () => {
    mockRequest({})
    await odataMockServerService.listen('r4')
    listenHttpServer.mockClear()
    const res = await odataMockServerService.listen('r4')
    expect(res.listening).toBe(true)
    expect(listenHttpServer).not.toHaveBeenCalled()
  })

  it('stopListening releases the port route + clears bookkeeping', async () => {
    mockRequest({})
    await odataMockServerService.listen('r5')
    expect(odataMockServerService.stopListening('r5')).toBe(true)
    expect(disconnect).toHaveBeenCalledWith('r5')
    expect(odataMockServerService.isListening('r5')).toBe(false)
    // A second stop is a no-op (already gone).
    expect(odataMockServerService.stopListening('r5')).toBe(false)
  })
})
