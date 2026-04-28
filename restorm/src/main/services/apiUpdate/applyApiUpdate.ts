import { logger } from 'electron-core-ui'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
import type { Request, ImportOrigin } from '../../../shared/types/requests'
import { isAnyFolder, isRequest } from '../../../shared/types/folderTypes'
import type { ImportSourceType } from '../../../shared/types/baseTypes'
import { runIdempotentImport, type RunIdempotentImportOptions } from '../import/idempotent/runIdempotentImport'
import type { ImportAdapter, ImportDiff, NormalizedOperation, NormalizedSpec } from '../import/idempotent/types'
import { swaggerImportAdapter } from '../import/idempotent/SwaggerAdapter'
import { graphqlImportAdapter } from '../import/idempotent/GraphQLAdapter'
import { openapi3ImportAdapter } from '../import/idempotent/OpenAPI3Adapter'
import { postmanImportAdapter } from '../import/idempotent/PostmanAdapter'
import { insomniaImportAdapter } from '../import/idempotent/InsomniaAdapter'
import { brunoImportAdapter } from '../import/idempotent/BrunoAdapter'
import { asyncapiImportAdapter } from '../import/idempotent/AsyncAPIAdapter'
import { grpcImportAdapter } from '../import/idempotent/GrpcAdapter'
import { soapImportAdapter } from '../import/idempotent/SoapAdapter'
import { odataImportAdapter } from '../import/idempotent/ODataAdapter'
import { computeSpecHash } from './specHash'
import { mergeHttpRequestShape } from './mergeRequestShape'

/**
 * Apply an available API update onto an existing env folder.
 *
 * The expensive piece — turning a normalised operation into a fully
 * wired `Request` instance — already exists in the per-format import
 * services. Rather than duplicate that logic here, we ask the caller
 * to perform a fresh import (`importNewFolder`) and pass the
 * resulting folder in. We then index the new folder by `naturalKey`
 * and use the matching child as the `createRequest` factory so
 * `runIdempotentImport` only sees the diff between what the user
 * already has and what the spec now says.
 *
 * The pipeline guarantees:
 *
 * - Existing requests the user customised keep every edit (name,
 *   custom params, description tweaks, etc.).
 * - Newly added operations land at the same path they would have
 *   landed in a fresh import (because the materialiser is the same
 *   one a fresh import uses).
 * - Operations that vanished from the spec stay in the folder,
 *   flagged `removed: true` for the UI to render struck-through.
 */
export interface ApplyApiUpdateInput {
  target: EnvironmentFolder
  /** Folder produced by re-running the per-format importer. Used as
   * the source of fully-materialised requests for new operations. */
  freshFolder: EnvironmentFolder
  spec: NormalizedSpec
  importSource: ImportSourceType
  /** The raw spec content as fetched, kept around so we can store
   * the right `lastImportedSpecHash` even when the spec has no
   * `info.version` to anchor against. */
  fetchedHash?: string
  fetchedVersion?: string
}

export interface ApplyApiUpdateResult {
  diff: ImportDiff
  appliedHash: string
  appliedVersion?: string
  /** The brand-new request instances the pipeline appended to
   * `target.items` for each `added` operation. The renderer uses
   * these to splice the new rows into its own copy of the folder
   * without overwriting unrelated state (sub-environments,
   * per-tab pinning) that hasn't synced back to main. */
  addedRequests: Request[]
}

const ADAPTERS: Partial<Record<ImportSourceType, ImportAdapter>> = {
  swagger: swaggerImportAdapter,
  openapi: openapi3ImportAdapter,
  graphql: graphqlImportAdapter,
  postman: postmanImportAdapter,
  insomnia: insomniaImportAdapter,
  bruno: brunoImportAdapter,
  asyncapi: asyncapiImportAdapter,
  grpc: grpcImportAdapter,
  wsdl: soapImportAdapter,
  odata: odataImportAdapter
}

/**
 * Walk a folder and produce a `naturalKey → Request` map. Requests
 * without an `importOrigin` are skipped — those are user-created and
 * can't participate in the merge.
 */
function indexFreshFolderByNaturalKey(folder: EnvironmentFolder): Map<string, Request> {
  const result = new Map<string, Request>()
  function visit(item: unknown): void {
    if (isAnyFolder(item as never)) {
      for (const child of (item as EnvironmentFolder).items) visit(child)
      return
    }
    if (isRequest(item as never)) {
      const req = item as Request
      const key = req.importOrigin?.naturalKey
      if (key) result.set(key, req)
    }
  }
  visit(folder)
  return result
}

export function applyApiUpdate(input: ApplyApiUpdateInput): ApplyApiUpdateResult {
  const adapter = ADAPTERS[input.importSource]
  if (!adapter) throw new Error(`No idempotent adapter for ${input.importSource}`)

  const freshIndex = indexFreshFolderByNaturalKey(input.freshFolder)

  const addedRequests: Request[] = []
  const options: RunIdempotentImportOptions = {
    target: input.target,
    spec: input.spec,
    adapter,
    createRequest: (op: NormalizedOperation, _origin: ImportOrigin): Request => {
      const fromFresh = freshIndex.get(op.naturalKey)
      if (!fromFresh) {
        // The fresh folder must contain every operation the spec
        // describes. If it doesn't, the per-format importer dropped
        // something; better to fail loudly than to silently produce
        // a half-merged folder.
        throw new Error(`Fresh import missing operation ${op.naturalKey}`)
      }
      addedRequests.push(fromFresh)
      return fromFresh
    },
    mergeRequestShape: mergeHttpRequestShape
  }

  const diff = runIdempotentImport(options)

  // Carry over the doc-side payload from the freshly-imported folder
  // so the env-folder home page reflects the new title / description /
  // model definitions, and so enum widening / narrowing reaches the
  // KV editors. The pipeline above handles the request tree; these
  // top-level fields aren't part of the request graph and would
  // otherwise stay frozen at the original import.
  const fresh = input.freshFolder as unknown as { apiDocumentation?: unknown; enumDefinitions?: unknown }
  const target = input.target as unknown as { apiDocumentation?: unknown; enumDefinitions?: unknown }
  if (fresh.apiDocumentation) target.apiDocumentation = fresh.apiDocumentation
  if (fresh.enumDefinitions) target.enumDefinitions = fresh.enumDefinitions

  const appliedHash = input.fetchedHash ?? computeSpecHash(input.spec)
  const result: ApplyApiUpdateResult = { diff, appliedHash, addedRequests }
  if (input.fetchedVersion !== undefined) result.appliedVersion = input.fetchedVersion
  logger.info(
    `[applyApiUpdate] applied to ${input.target.id}: +${diff.added.length} ⤓${diff.deprecated.length} ⌽${diff.removed.length} ↻${diff.merged.length}`
  )
  return result
}
