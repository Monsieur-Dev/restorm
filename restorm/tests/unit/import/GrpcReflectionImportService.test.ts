import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importGrpcFromReflection, reimportGrpcReflection } from '../../../src/main/services/import/GrpcReflectionImportService'
import { isAnyFolder, isRequest } from '../../../src/shared/types/collections'
import { isGrpcRequest } from '../../../src/shared/types/requests'
import type { FolderItem } from '../../../src/shared/types/collections'
import {
  buildDemoFileDescriptorSet,
  buildDemoFileDescriptorSetWithExtraMethod
} from '../fixtures/grpcDescriptorProtoFixture'

// `reimportGrpcReflection` routes through `applyApiUpdate`, which logs via
// `electron-core-ui`'s `logger` — that reads `app.isPackaged` under the
// hood, and there's no real Electron `app` in a vitest run. Same mock shape
// `GRPCMockServerService.test.ts` uses for the same reason.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('electron-core-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui')>()
  return { ...actual, logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }
})

// `queryReflection` is the only network-touching call in the import path —
// mocking it (instead of spinning up a real gRPC server) keeps this test
// fast and offline while still exercising the REAL decode
// (`loadFileDescriptorSetFromBuffer`) + normalize (`grpcDescriptorToParsedProto`)
// + build (`buildEnvironmentFolderFromParsedProto`) + stamp pipeline on the
// wire-accurate fixture descriptor set. A mutable `vi.fn()` (rather than a
// fixed return) lets the idempotency tests below simulate the server's
// method set changing between two fetches.
const queryReflectionMock = vi.fn(() => Promise.resolve({
  services: ['demo.Greeter'],
  fileDescriptorSet: buildDemoFileDescriptorSet()
}))
vi.mock('../../../src/main/services/grpc/grpcReflectionClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/grpc/grpcReflectionClient')>()
  return { ...actual, queryReflection: (...args: unknown[]) => queryReflectionMock(...(args as [])) }
})

beforeEach(() => {
  queryReflectionMock.mockReset()
  queryReflectionMock.mockImplementation(() => Promise.resolve({
    services: ['demo.Greeter'],
    fileDescriptorSet: buildDemoFileDescriptorSet()
  }))
})

function collectRequests(items: FolderItem[]): FolderItem[] {
  const out: FolderItem[] = []
  for (const item of items) {
    if (isAnyFolder(item)) out.push(...collectRequests(item.items))
    else out.push(item)
  }
  return out
}

describe('importGrpcFromReflection', () => {
  it('builds an EnvironmentFolder from the reflected descriptor set', async () => {
    const { folder, protoDescriptorSet } = await importGrpcFromReflection('localhost:9000')
    expect(folder.folderType).toBe('environment')
    expect(protoDescriptorSet).toBe(buildDemoFileDescriptorSet().toString('base64'))

    const requests = collectRequests(folder.items)
    const grpcRequests = requests.filter((r) => isRequest(r) && isGrpcRequest(r))
    expect(grpcRequests).toHaveLength(1)
    expect((grpcRequests[0] as { method: string }).method).toBe('Ping')
  })

  it('stamps the fetched descriptor set on every generated request (AC: offline reuse)', async () => {
    const { folder, protoDescriptorSet } = await importGrpcFromReflection('localhost:9000')
    const requests = collectRequests(folder.items).filter((r) => isRequest(r) && isGrpcRequest(r))
    expect(requests.length).toBeGreaterThan(0)
    for (const req of requests) {
      expect((req as { protoDescriptorSet?: string }).protoDescriptorSet).toBe(protoDescriptorSet)
    }
  })

  it('names the collection from the reflected package when no name option is given', async () => {
    const { folder } = await importGrpcFromReflection('localhost:9000')
    expect(folder.name).toBe('demo')
  })

  it('honors an explicit name option', async () => {
    const { folder } = await importGrpcFromReflection('localhost:9000', { name: 'My gRPC server' })
    expect(folder.name).toBe('My gRPC server')
  })

  it('stamps apiUpdate.sourceUrl so a later reflection against the same address is recognisable as a re-import', async () => {
    const { folder } = await importGrpcFromReflection('localhost:9000')
    expect(folder.apiUpdate?.sourceUrl).toBe('grpc-reflection://localhost:9000')
  })
})

describe('reimportGrpcReflection — idempotency (main/services/import/idempotent/GrpcAdapter.ts contract)', () => {
  it('re-fetching an UNCHANGED server is a no-op: empty diff, no duplicate requests', async () => {
    const { folder: target } = await importGrpcFromReflection('localhost:9000')
    const before = collectRequests(target.items).filter((r) => isRequest(r) && isGrpcRequest(r))
    expect(before).toHaveLength(1)

    const { diff } = await reimportGrpcReflection(target, 'localhost:9000')

    // Operation-level invariant — no added/removed/merged/deprecated
    // requests. NOT `isImportDiffEmpty(diff)`: `runIdempotentImport`
    // unconditionally re-tallies `modelsAdded`/`enumsAdded` from the
    // CURRENT spec's non-deprecated models on every run (a pre-existing
    // "confirmation modal counter" behaviour shared by every adapter with
    // models, not something reflection-specific), so it's never a reliable
    // no-op signal for a spec that carries message types — gRPC always
    // does. See `main/services/import/idempotent/runIdempotentImport.ts`.
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.merged).toHaveLength(0)
    expect(diff.deprecated).toHaveLength(0)
    const after = collectRequests(target.items).filter((r) => isRequest(r) && isGrpcRequest(r))
    expect(after).toHaveLength(1)
  })

  it('a server that gained a method: the new one is added, the existing one is untouched (not duplicated)', async () => {
    const { folder: target } = await importGrpcFromReflection('localhost:9000')
    const originalPingId = (collectRequests(target.items).find(
      (r) => isRequest(r) && isGrpcRequest(r) && r.method === 'Ping'
    ) as { id: string }).id

    queryReflectionMock.mockImplementation(() => Promise.resolve({
      services: ['demo.Greeter'],
      fileDescriptorSet: buildDemoFileDescriptorSetWithExtraMethod()
    }))
    const { diff } = await reimportGrpcReflection(target, 'localhost:9000')

    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(0)
    const requests = collectRequests(target.items).filter((r) => isRequest(r) && isGrpcRequest(r)) as { id: string; method: string }[]
    expect(requests.map((r) => r.method).sort()).toEqual(['Echo', 'Ping'])
    // The pre-existing Ping request kept its identity — matched by
    // `importOrigin.naturalKey`, not replaced by a fresh instance.
    expect(requests.find((r) => r.method === 'Ping')?.id).toBe(originalPingId)
  })

  it('a server that lost a method: the vanished request is flagged removed, not deleted', async () => {
    queryReflectionMock.mockImplementation(() => Promise.resolve({
      services: ['demo.Greeter'],
      fileDescriptorSet: buildDemoFileDescriptorSetWithExtraMethod()
    }))
    const { folder: target } = await importGrpcFromReflection('localhost:9000')
    expect(collectRequests(target.items)).toHaveLength(2)

    queryReflectionMock.mockImplementation(() => Promise.resolve({
      services: ['demo.Greeter'],
      fileDescriptorSet: buildDemoFileDescriptorSet()
    }))
    const { diff } = await reimportGrpcReflection(target, 'localhost:9000')

    expect(diff.removed).toHaveLength(1)
    // Still present in the tree (non-destructive), just flagged.
    const requests = collectRequests(target.items).filter((r) => isRequest(r) && isGrpcRequest(r)) as { method: string; removed?: boolean }[]
    expect(requests).toHaveLength(2)
    expect(requests.find((r) => r.method === 'Echo')?.removed).toBe(true)
    expect(requests.find((r) => r.method === 'Ping')?.removed).toBeFalsy()
  })

  it('refreshes protoDescriptorSet on every request, including ones matched from before the re-fetch', async () => {
    const { folder: target, protoDescriptorSet: firstDescriptorSet } = await importGrpcFromReflection('localhost:9000')

    queryReflectionMock.mockImplementation(() => Promise.resolve({
      services: ['demo.Greeter'],
      fileDescriptorSet: buildDemoFileDescriptorSetWithExtraMethod()
    }))
    const { protoDescriptorSet: secondDescriptorSet } = await reimportGrpcReflection(target, 'localhost:9000')

    expect(secondDescriptorSet).not.toBe(firstDescriptorSet)
    const requests = collectRequests(target.items).filter((r) => isRequest(r) && isGrpcRequest(r)) as { protoDescriptorSet?: string }[]
    for (const req of requests) expect(req.protoDescriptorSet).toBe(secondDescriptorSet)
  })
})
