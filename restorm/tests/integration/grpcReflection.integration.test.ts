/**
 * Integration tests for gRPC server reflection against a REAL server —
 * `moul/grpcbin` (port 9000, already in `tests/docker/docker-compose.yml`),
 * which enables `grpc.reflection.v1alpha.ServerReflection` by default. The
 * unit tests cover the wire-format parsing offline (hand-crafted fixtures);
 * this suite proves the same code talks to an actual reflection-enabled
 * server correctly — the two failure modes a fixture can't catch (a real
 * bidi stream's request/response framing, and a real server's exact
 * FileDescriptorSet shape).
 */

import { describe, it, expect, beforeAll } from 'vitest'

// Docker setup — same shared services.integration.test.ts already waits on
// (grpcbin is health-checked in `wait-for-services.js`).
import {
  isDockerAvailable,
  startDocker,
  waitForServices,
  areContainersRunning,
  areServicesAccessible
} from './docker-setup'

import { queryReflection } from '../../src/main/services/grpc/grpcReflectionClient'
import { importGrpcFromReflection } from '../../src/main/services/import/GrpcReflectionImportService'
import { isAnyFolder, isRequest } from '../../src/shared/types/collections'
import { isGrpcRequest } from '../../src/shared/types/requests'
import type { FolderItem } from '../../src/shared/types/collections'

const GRPCBIN_ADDRESS = 'localhost:9000'

function collectRequests(items: FolderItem[]): FolderItem[] {
  const out: FolderItem[] = []
  for (const item of items) {
    if (isAnyFolder(item)) out.push(...collectRequests(item.items))
    else out.push(item)
  }
  return out
}

describe('gRPC reflection — live moul/grpcbin', () => {
  let dockerAvailable = false
  let containersStarted = false

  beforeAll(async () => {
    dockerAvailable = isDockerAvailable()
    if (!dockerAvailable) return

    const servicesAccessible = await areServicesAccessible()
    if (servicesAccessible) {
      containersStarted = true
      return
    }

    const alreadyRunning = areContainersRunning()
    if (alreadyRunning) {
      containersStarted = true
      try {
        await waitForServices()
      } catch {
        // Services might already be ready.
      }
      return
    }

    try {
      startDocker()
      await waitForServices()
      containersStarted = true
    } catch {
      const nowAccessible = await areServicesAccessible()
      containersStarted = nowAccessible
    }
  }, 120000)

  it('queryReflection lists grpcbin.GRPCBin', async () => {
    if (!dockerAvailable || !containersStarted) return

    const { services, fileDescriptorSet } = await queryReflection(GRPCBIN_ADDRESS)
    expect(services).toContain('grpcbin.GRPCBin')
    expect(fileDescriptorSet.byteLength).toBeGreaterThan(0)
  }, 30000)

  it('importGrpcFromReflection builds the same call surface as the bundled proto-file import', async () => {
    if (!dockerAvailable || !containersStarted) return

    const { folder, protoDescriptorSet } = await importGrpcFromReflection(GRPCBIN_ADDRESS)
    expect(folder.folderType).toBe('environment')
    expect(protoDescriptorSet.length).toBeGreaterThan(0)

    const grpcRequests = collectRequests(folder.items).filter((r) => isRequest(r) && isGrpcRequest(r))
    const methodNames = new Set(grpcRequests.map((r) => (r as { method: string }).method))
    // Same unary / server-stream / client-stream / bidi quartet the bundled
    // grpcbin.proto fallback exposes (see grpcProtoLoader.test.ts) — proves
    // reflection discovers the real server's full method surface, not a
    // partial one.
    expect(methodNames.has('DummyUnary')).toBe(true)
    expect(methodNames.has('DummyServerStream')).toBe(true)
    expect(methodNames.has('DummyClientStream')).toBe(true)
    expect(methodNames.has('DummyBidirectionalStreamStream')).toBe(true)

    // Every generated request carries the fetched descriptor set, so it can
    // execute (and be refreshed) fully offline afterward.
    for (const req of grpcRequests) {
      expect((req as { protoDescriptorSet?: string }).protoDescriptorSet).toBe(protoDescriptorSet)
    }
  }, 30000)

  it('rejects when nothing is listening — never hangs or silently returns an empty result', async () => {
    if (!dockerAvailable || !containersStarted) return

    await expect(queryReflection('localhost:1')).rejects.toThrow()
  }, 15000)
})
