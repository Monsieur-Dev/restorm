/**
 * Integration test for the gRPC projection of the design server.
 *
 * Spins the REAL `DesignServerService` on a design with 'grpc' enabled —
 * which binds a separate `@grpc/grpc-js` HTTP/2 server on its own port —
 * and drives it with a real gRPC client loaded from the projected
 * `.proto`, proving the full loop: a unary by-id call answers the bound
 * example, a list call answers the pagination envelope, the design's
 * default auth is enforced through call metadata, and the port frees on
 * stop. Only the surrounding singletons (electron / logger / the
 * WebSocketExecution->CollectionStore import chain) are stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { isPackaged: false, getPath: () => '/tmp' }
}))
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withFirewallBypassSync: <T>(fn: () => T): T => fn(),
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn(), asyncIterator: vi.fn() }),
  eventBusService: { publish: vi.fn(), subscribe: vi.fn(() => () => undefined) },
  serializeWithDecorators: (v: unknown) => v,
  createSchema: vi.fn(),
  createYoga: vi.fn()
}))
vi.mock('../../src/main/services/ContextService', () => ({
  contextService: { getRequestContext: vi.fn(), resolveUrlForRequest: () => undefined }
}))

import { designServerService } from '../../src/main/services/DesignServerService'
import { designToProto, designProtoPackage, designProtoServiceName } from '../../src/shared/design/grpcProjection'
import { buildReferenceApiDesign } from '../unit/apiDesignReference'
import type { ApiDesign } from '../../src/shared/types/apiDesign'

const LOAD_OPTIONS: protoLoader.Options = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => { resolve(port) })
    })
  })
}

type UnaryFn = (
  req: object,
  md: grpc.Metadata,
  cb: (err: grpc.ServiceError | null, res: Record<string, unknown>) => void
) => void
type DesignClient = grpc.Client & { GetUser: UnaryFn; ListUsers: UnaryFn }

function makeClient(design: ApiDesign, grpcPort: number): DesignClient {
  const file = join(mkdtempSync(join(tmpdir(), 'restorm-grpc-itest-')), 'design.proto')
  writeFileSync(file, designToProto(design), 'utf8')
  const pkgDef = protoLoader.loadSync(file, LOAD_OPTIONS)
  const root = grpc.loadPackageDefinition(pkgDef)
  const pkg = root[designProtoPackage(design)] as grpc.GrpcObject
  const ctor = pkg[designProtoServiceName(design)] as unknown as grpc.ServiceClientConstructor
  return new ctor(`127.0.0.1:${grpcPort}`, grpc.credentials.createInsecure()) as unknown as DesignClient
}

function call(
  client: DesignClient,
  fn: UnaryFn,
  req: object,
  md: grpc.Metadata
): Promise<{ err: grpc.ServiceError | null; res: Record<string, unknown> }> {
  return new Promise((resolve) => {
    // Bind to the client — a detached unary method loses its `this`.
    fn.call(client, req, md, (err, res) => { resolve({ err, res }) })
  })
}

function bearer(): grpc.Metadata {
  const md = new grpc.Metadata()
  md.set('authorization', 'Bearer test-token')
  return md
}

describe('DesignServerService — gRPC projection', () => {
  let design: ApiDesign
  let grpcPort = 0
  let client: DesignClient

  beforeEach(async () => {
    const httpPort = await freePort()
    grpcPort = await freePort()
    design = buildReferenceApiDesign()
    design.serving = { protocols: ['grpc'], port: httpPort, grpcPort, latencyMs: 0 }
    const result = await designServerService.start(design)
    expect(result.listening).toBe(true)
    // The gRPC server binds its own port, surfaced on the status.
    expect(designServerService.status(design.id).grpcPort).toBe(grpcPort)
    client = makeClient(design, grpcPort)
  })

  afterEach(() => {
    client.close()
    designServerService.closeAll()
  })

  it('answers a by-id unary call with the route\'s bound example', async () => {
    const { err, res } = await call(client, client.GetUser, { id: '1' }, bearer())
    expect(err).toBeNull()
    expect(res['email']).toBe('admin@example.com')
    expect(res['status']).toBe('active')
  })

  it('answers a list call with the pagination envelope', async () => {
    const { err, res } = await call(client, client.ListUsers, { limit: 2, offset: 0 }, bearer())
    expect(err).toBeNull()
    expect(Array.isArray(res['items'])).toBe(true)
    expect(typeof res['total']).toBe('number')
    expect(res['limit']).toBe(2)
    expect(res['offset']).toBe(0)
  })

  it('enforces the default auth: an unauthenticated call is rejected', async () => {
    const { err } = await call(client, client.GetUser, { id: '1' }, new grpc.Metadata())
    expect(err).not.toBeNull()
    expect(err?.code).toBe(grpc.status.UNAUTHENTICATED)
  })

  it('frees the gRPC port after stop', async () => {
    designServerService.stop(design.id)
    const start = Date.now()
    let free = false
    while (Date.now() - start < 4000 && !free) {
      free = await new Promise<boolean>((resolve) => {
        const srv = createNetServer()
        srv.unref()
        srv.once('error', () => { resolve(false) })
        srv.listen(grpcPort, '127.0.0.1', () => srv.close(() => { resolve(true) }))
      })
      if (!free) await new Promise((r) => setTimeout(r, 20))
    }
    expect(free).toBe(true)
  })
})
