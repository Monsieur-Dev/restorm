/**
 * Integration test for restorm acting AS a local OData v4 mock service.
 *
 * Hosts the real service through `ODataMockServerService` (the same code the
 * request panel and the scenario engine drive) — which registers its routes on
 * the shared HTTP `PortHost` in `WebSocketExecutionService` — and hits it with a
 * plain Node HTTP client, proving the full loop: `$metadata`, the entity-set
 * collection with system query options applied, a by-key read, `/$count`, and a
 * `$batch`. Only the surrounding singletons (ContextService / electron / logger)
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createNetServer } from 'node:net'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { isPackaged: false, getPath: () => '/tmp' }
}))
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withFirewallBypassSync: <T>(fn: () => T): T => fn(),
  // The import chain (WebSocketExecutionService → CollectionStore) calls
  // createPubSub(...) + eventBusService + serializeWithDecorators at module
  // load, so the mock must provide them or the module throws on import.
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn(), asyncIterator: vi.fn() }),
  eventBusService: { publish: vi.fn(), subscribe: vi.fn(() => () => undefined) },
  serializeWithDecorators: (v: unknown) => v
}))

import { odataMockServerService, DEFAULT_ODATA_SERVICE_ROOT } from '../../src/main/services/ODataMockServerService'
import { contextService } from '../../src/main/services/ContextService'

vi.mock('../../src/main/services/ContextService', () => ({
  contextService: { getRequestContext: vi.fn() }
}))

const METADATA = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Test" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Pet">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
        <Property Name="Status" Type="Edm.String"/>
        <Property Name="CategoryId" Type="Edm.Int32"/>
        <NavigationProperty Name="Category" Type="Test.Category"/>
      </EntityType>
      <EntityType Name="Category">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Pets" EntityType="Test.Pet"/>
        <EntitySet Name="Categories" EntityType="Test.Category"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`

const DATA = {
  Pets: [
    { Id: 1, Name: 'Rex', Status: 'Available', CategoryId: 1 },
    { Id: 2, Name: 'Whiskers', Status: 'Pending', CategoryId: 2 },
    { Id: 3, Name: 'Rover', Status: 'Available', CategoryId: 1 }
  ],
  Categories: [
    { Id: 1, Name: 'Dogs' },
    { Id: 2, Name: 'Cats' }
  ]
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => { resolve(port); })
    })
  })
}

interface HttpResult { status: number; body: string; contentType: string }

function get(port: number, path: string): Promise<HttpResult> {
  return req(port, 'GET', path)
}

function req(port: number, method: string, path: string, body?: string, headers?: Record<string, string>): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const r = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => { chunks.push(c) })
      res.on('end', () => {
        const ct = res.headers['content-type']
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), contentType: Array.isArray(ct) ? ct.join(', ') : (ct ?? '') })
      })
    })
    r.on('error', reject)
    if (body !== undefined) r.write(body)
    r.end()
  })
}

const REQUEST_ID = 'odata-mock-1'

describe('ODataMockServerService — hosted OData v4 mock', () => {
  let port = 0

  beforeEach(async () => {
    port = await freePort()
    vi.mocked(contextService.getRequestContext).mockReturnValue({
      fullData: {
        type: 'odata',
        server: true,
        url: `localhost:${port}${DEFAULT_ODATA_SERVICE_ROOT}`,
        mockMetadata: METADATA,
        mockData: DATA
      }
    } as unknown as ReturnType<typeof contextService.getRequestContext>)
    const result = await odataMockServerService.listen(REQUEST_ID)
    expect(result.listening).toBe(true)
  })

  afterEach(() => {
    odataMockServerService.closeAll()
  })

  it('serves the $metadata CSDL verbatim', async () => {
    const res = await get(port, `${DEFAULT_ODATA_SERVICE_ROOT}/$metadata`)
    expect(res.status).toBe(200)
    expect(res.contentType).toContain('xml')
    expect(res.body).toContain('<EntitySet Name="Pets"')
  })

  it('serves an entity-set collection in the v4 envelope', async () => {
    const res = await get(port, `${DEFAULT_ODATA_SERVICE_ROOT}/Pets`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { value: { Id: number }[]; '@odata.context': string }
    expect(body['@odata.context']).toContain('$metadata#Pets')
    expect(body.value.map((p) => p.Id)).toEqual([1, 2, 3])
  })

  it('applies $filter + $select + $orderby + $top', async () => {
    const res = await get(port, `${DEFAULT_ODATA_SERVICE_ROOT}/Pets?$filter=${encodeURIComponent("Status eq 'Available'")}&$orderby=${encodeURIComponent('Id desc')}&$top=1&$select=Name`)
    const body = JSON.parse(res.body) as { value: Record<string, unknown>[] }
    expect(body.value).toEqual([{ Name: 'Rover' }])
  })

  it('serves a by-key single entity with $expand', async () => {
    const res = await get(port, `${DEFAULT_ODATA_SERVICE_ROOT}/Pets(1)?$expand=Category`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as { Id: number; Category: { Name: string } }
    expect(body.Id).toBe(1)
    expect(body.Category).toEqual({ Id: 1, Name: 'Dogs' })
  })

  it('serves /$count and $count=true', async () => {
    const count = await get(port, `${DEFAULT_ODATA_SERVICE_ROOT}/Pets/$count`)
    expect(count.body.trim()).toBe('3')
    const inline = await get(port, `${DEFAULT_ODATA_SERVICE_ROOT}/Pets?$count=true&$top=1`)
    const body = JSON.parse(inline.body) as { '@odata.count': number; value: unknown[] }
    expect(body['@odata.count']).toBe(3)
    expect(body.value.length).toBe(1)
  })

  it('404s an unknown entity set', async () => {
    const res = await get(port, `${DEFAULT_ODATA_SERVICE_ROOT}/Nope`)
    expect(res.status).toBe(404)
  })

  it('dispatches a $batch of GET sub-requests', async () => {
    const boundary = 'batch_test'
    const body = [
      `--${boundary}`,
      'Content-Type: application/http',
      '',
      `GET ${DEFAULT_ODATA_SERVICE_ROOT}/Pets(1) HTTP/1.1`,
      '',
      '',
      `--${boundary}--`,
      ''
    ].join('\r\n')
    const res = await req(port, 'POST', `${DEFAULT_ODATA_SERVICE_ROOT}/$batch`, body, {
      'Content-Type': `multipart/mixed; boundary=${boundary}`
    })
    expect(res.status).toBe(200)
    expect(res.contentType).toContain('multipart/mixed')
    expect(res.body).toContain('200 OK')
    expect(res.body).toContain('"Id":1')
  })

  it('frees the port after closeAll', async () => {
    odataMockServerService.closeAll()
    // The OS socket close is async; poll until the port is bindable.
    const start = Date.now()
    let free = false
    while (Date.now() - start < 4000 && !free) {
      free = await new Promise<boolean>((resolve) => {
        const srv = createServer()
        srv.unref()
        srv.once('error', () => { resolve(false); })
        srv.listen(port, '127.0.0.1', () => srv.close(() => { resolve(true); }))
      })
      if (!free) await new Promise((r) => setTimeout(r, 20))
    }
    expect(free).toBe(true)
  })
})
