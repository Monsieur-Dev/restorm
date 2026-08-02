import { describe, it, expect } from 'vitest'

import {
  REQUEST_CLASS_REGISTRY,
  createRequestFromPlain
} from '../../src/shared/models/requests/requestFactory'
import type { RequestType } from '../../src/shared/protocolRegistry'
import type { Request } from '../../src/shared/types/requests'

/**
 * The import markers (`importOrigin` / `deprecated` / `removed`) are
 * the only link between a request on disk and the spec operation it
 * came from. Every request class must carry them across BOTH
 * serialization boundaries:
 *
 * - `toPlainObject()` — what the project file and the eventBus
 *   payloads are built from;
 * - `fromPlain()` (through `createRequestFromPlain`) — what the
 *   collection-reify pass runs on the renderer's mirror and on a
 *   freshly loaded project.
 *
 * A class that drops them turns the next "update from source" into a
 * full re-import: `runIdempotentImport` finds no `importOrigin` to
 * match on, re-adds every operation as a duplicate, and has nothing
 * left to flag as removed. The check is table-driven over the whole
 * registry so a newly added protocol can't quietly opt out.
 */
const MARKERS = {
  importOrigin: { format: 'openapi' as const, operationId: 'listItems', naturalKey: 'GET /items' },
  deprecated: true,
  removed: true
}

/** `toPlainObject` is optional on the `Request` INTERFACE (a request
 * read off disk is a method-less POJO), but mandatory on every model
 * class — which is what this suite instantiates. */
function serialize(request: Request): Record<string, unknown> {
  const plain = request.toPlainObject?.()
  if (!plain) throw new Error(`${request.type} does not implement toPlainObject`)
  return plain
}

function buildRequest(type: RequestType, seed: Record<string, unknown>): Request {
  const entry = REQUEST_CLASS_REGISTRY[type] as { fromPlain: (d: never) => Request } | undefined
  if (!entry) throw new Error(`no registry entry for ${type}`)
  return entry.fromPlain({ type, ...seed } as never)
}

describe('import markers round-trip', () => {
  const types = Object.keys(REQUEST_CLASS_REGISTRY) as RequestType[]

  it.each(types)('%s survives toPlainObject → fromPlain', (type) => {
    const instance = buildRequest(type, { id: `req-${type}`, name: `${type} request`, ...MARKERS })

    expect(instance.importOrigin).toEqual(MARKERS.importOrigin)
    expect(instance.deprecated).toBe(true)
    expect(instance.removed).toBe(true)

    // The exact hop a save performs: serialize, write, read back.
    const onDisk = JSON.parse(JSON.stringify(serialize(instance))) as Record<string, unknown>
    expect(onDisk['importOrigin']).toEqual(MARKERS.importOrigin)
    expect(onDisk['deprecated']).toBe(true)
    expect(onDisk['removed']).toBe(true)

    const reloaded = createRequestFromPlain(onDisk as never)
    expect(reloaded.importOrigin).toEqual(MARKERS.importOrigin)
    expect(reloaded.deprecated).toBe(true)
    expect(reloaded.removed).toBe(true)
  })

  it.each(types)('%s emits no marker keys when none are set', (type) => {
    // A user-created request must stay marker-free: the pipeline reads
    // the ABSENCE of `importOrigin` as "never touch this request", so a
    // serializer that materialised `importOrigin: undefined` (or a
    // defaulted `removed: false`) would be a different kind of bug.
    const instance = buildRequest(type, { id: 'r', name: 'manual' })
    const onDisk = serialize(instance)
    expect(onDisk['importOrigin']).toBeUndefined()
    expect(onDisk['removed']).toBeUndefined()
  })
})
