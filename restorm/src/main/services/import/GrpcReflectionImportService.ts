/**
 * Import a gRPC server's services/methods by querying its reflection
 * service, instead of parsing a `.proto` file on disk. Bypasses the
 * text-content `ImportManager` pipeline entirely (there's no file/URL text
 * to sniff — the "source" is a live `host:port` connection) but produces the
 * exact same `EnvironmentFolder` shape as `GrpcImportService.importGrpc`,
 * and every generated request carries its own `protoDescriptorSet` so
 * execution — and a later "Refresh from reflection" — works fully offline
 * from the bundle this fetch returned.
 */

import * as protoLoader from '@grpc/proto-loader'
import { queryReflection, type GrpcReflectionOptions } from '../grpc/grpcReflectionClient'
import { grpcDescriptorToParsedProto } from './transformers/grpcDescriptorToParsedProto'
import { buildEnvironmentFolderFromParsedProto, type GrpcImportOptions } from './GrpcImportService'
import { grpcImportAdapter } from './idempotent/GrpcAdapter'
import { applyApiUpdate } from '../apiUpdate/applyApiUpdate'
import { computeSpecHash } from '../apiUpdate/specHash'
import type { ImportDiff } from './idempotent/types'
import { collectionStore, pubsub, PUBSUB_TOPICS } from '../CollectionStore'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/collections'
import { isAnyFolder, isRequest, isGrpcRequest } from '../../../shared/types/collections'

/** Same decode options `grpcProtoLoader.ts` uses for every other proto load,
 * so a reflection-derived package resolves identically to a file-based one. */
const REFLECTION_LOAD_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
}

export interface GrpcReflectionImportOptions extends GrpcReflectionOptions {
  /** Name for the imported collection (defaults to the server's proto package). */
  name?: string
}

export interface GrpcReflectionImportResult {
  folder: EnvironmentFolder
  /** Base64 `FileDescriptorSet` stamped on every generated request — also
   * returned standalone so a caller refreshing a single request (rather than
   * re-running a full import) doesn't need to re-walk the folder tree. */
  protoDescriptorSet: string
}

/** Stamp the freshly-fetched descriptor set onto every gRPC request in the
 * tree, so each one resolves its own proto for execution without depending
 * on any other request or a later network round-trip (AC: offline reuse). */
function stampDescriptorSet(items: FolderItem[], protoDescriptorSet: string): void {
  for (const item of items) {
    if (isAnyFolder(item)) {
      stampDescriptorSet(item.items, protoDescriptorSet)
    } else if (isRequest(item) && isGrpcRequest(item)) {
      item.protoDescriptorSet = protoDescriptorSet
    }
  }
}

/** Non-fetchable pseudo-URL identifying a reflection import's live source
 * (there's no spec document to re-GET — the source is a `host:port`
 * connection). Stamped on `apiUpdate.sourceUrl` purely as an identity key so
 * a later reflection against the SAME address can be recognised as a
 * re-import of the same folder rather than a brand-new one. */
function sourceUrlFor(address: string): string {
  return `grpc-reflection://${address}`
}

/**
 * Find an already-imported reflection folder for `address`, if any — the
 * lookup that makes a repeated "Connect to a server" a re-import (merge)
 * instead of a silent duplicate. Reflection imports always land at the
 * project root (env-folder), so scanning top-level collections is enough;
 * no need to walk into subfolders.
 */
export function findExistingGrpcReflectionFolder(address: string): EnvironmentFolder | null {
  const wanted = sourceUrlFor(address)
  for (const collection of collectionStore.getCollections()) {
    if (collection.importSource === 'grpc' && collection.apiUpdate?.sourceUrl === wanted) return collection
  }
  return null
}

/**
 * Query `address`'s reflection service and build an `EnvironmentFolder` of
 * its services + methods — the reflection equivalent of
 * `GrpcImportService.importGrpc`. Throws {@link GrpcReflectionUnsupportedError}
 * (from `grpcReflectionClient`) when the server doesn't implement
 * `grpc.reflection.v1alpha.ServerReflection`; callers surface its message
 * verbatim as the user-facing error.
 */
export async function importGrpcFromReflection(
  address: string,
  options: GrpcReflectionImportOptions = {}
): Promise<GrpcReflectionImportResult> {
  const { services, fileDescriptorSet } = await queryReflection(address, options)
  const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(fileDescriptorSet, REFLECTION_LOAD_OPTIONS)
  const parsed = grpcDescriptorToParsedProto(pkgDef, services)

  const sourceUrl = sourceUrlFor(address)
  const importOptions: GrpcImportOptions = {
    baseUrl: address,
    sourceUrl,
    ...(options.name !== undefined ? { name: options.name } : {})
  }
  const folder = buildEnvironmentFolderFromParsedProto(parsed, importOptions)
  const protoDescriptorSet = fileDescriptorSet.toString('base64')
  stampDescriptorSet(folder.items, protoDescriptorSet)
  // Stamp the same identity `findExistingGrpcReflectionFolder` looks up, so a
  // later "Connect to a server" against this SAME address is recognised as a
  // re-import of this folder (see `reimportGrpcReflection`) instead of
  // silently producing a duplicate.
  folder.apiUpdate = { sourceUrl, lastImportedAt: Date.now() }

  return { folder, protoDescriptorSet }
}

export interface GrpcReflectionReimportResult {
  diff: ImportDiff
  protoDescriptorSet: string
}

/**
 * Re-query `address`'s reflection service and merge the result into an
 * ALREADY-imported `target` folder (found via {@link findExistingGrpcReflectionFolder})
 * instead of building a brand-new tree — the gRPC reflection counterpart of
 * `apiUpdate`'s "Refresh from source", routed through the SAME idempotent
 * pipeline (`runIdempotentImport` + `grpcImportAdapter`,
 * `main/services/import/idempotent/GrpcAdapter.ts`) every other importer
 * uses for its refresh path. Re-fetching an UNCHANGED server produces an
 * empty diff (`isImportDiffEmpty(diff) === true`) — no duplicate services,
 * methods, or folders. Mutates `target` in place.
 */
export async function reimportGrpcReflection(
  target: EnvironmentFolder,
  address: string,
  options: GrpcReflectionOptions = {}
): Promise<GrpcReflectionReimportResult> {
  const { services, fileDescriptorSet } = await queryReflection(address, options)
  const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(fileDescriptorSet, REFLECTION_LOAD_OPTIONS)
  const parsed = grpcDescriptorToParsedProto(pkgDef, services)
  const protoDescriptorSet = fileDescriptorSet.toString('base64')

  const freshFolder = buildEnvironmentFolderFromParsedProto(parsed, { baseUrl: address, sourceUrl: sourceUrlFor(address) })
  stampDescriptorSet(freshFolder.items, protoDescriptorSet)

  const spec = grpcImportAdapter.extractNormalizedSpec(parsed, {})
  const { diff } = applyApiUpdate({
    target,
    freshFolder,
    spec,
    importSource: 'grpc',
    fetchedHash: computeSpecHash(spec)
  })

  // `applyApiUpdate`'s generic pipeline only replaces a matched request's
  // instance for NEW operations (sourced straight from `freshFolder`,
  // already stamped above) — an EXISTING, merely-matched request keeps its
  // own object, so its (now stale) `protoDescriptorSet` needs an explicit
  // refresh here. Re-walking `target` (rather than passing a
  // `mergeRequestShape` hook into `applyApiUpdate`) keeps this reflection-
  // specific concern out of the format-agnostic pipeline.
  stampDescriptorSet(target.items, protoDescriptorSet)

  target.apiUpdate = {
    sourceUrl: sourceUrlFor(address),
    lastImportedAt: Date.now(),
    lastCheckedAt: Date.now()
  }

  // Same broadcast `orchestrateApply.ts` fires after an apiUpdate merge —
  // other windows / the disk-save debounce pick up the mutated folder.
  pubsub.publish(PUBSUB_TOPICS.FOLDER_UPDATED, target)

  return { diff, protoDescriptorSet }
}
