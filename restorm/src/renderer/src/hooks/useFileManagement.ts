/**
 * Hook for managing file operations (open, save, close)
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  useFileService,
  setContentChecksum,
  finishLoading,
  hasContentChanged,
  eventBus,
  logger,
  toasterService,
  decomposeForPersistence,
  hydrateSaveUnit,
  type DecomposedUnit
} from 'electron-core-ui/renderer'
import { Folder as FolderClass } from '../../../shared/models/Folder'
import { EnvironmentFolder as EnvironmentFolderClass } from '../../../shared/models/EnvironmentFolder'
import { Environment as EnvironmentClass } from '../../../shared/models/Environment'
import { KeyValue as KeyValueClass } from '../../../shared/models/KeyValue'
import { ApiDesign as ApiDesignClass } from '../../../shared/models/ApiDesign'
import { RecordingSession as RecordingSessionClass } from '../../../shared/models/RecordingSession'
import { HTTPRequest } from '../../../shared/models/requests/HTTPRequest'
import { SoapRequest } from '../../../shared/models/requests/SoapRequest'
import { GrpcRequest } from '../../../shared/models/requests/GrpcRequest'
import { GraphQLRequest } from '../../../shared/models/requests/GraphQLRequest'
import { WebSocketRequest } from '../../../shared/models/requests/WebSocketRequest'
import { SseRequest } from '../../../shared/models/requests/SseRequest'
import { ODataRequest } from '../../../shared/models/requests/ODataRequest'
import { AuthenticationRequest } from '../../../shared/models/requests/AuthenticationRequest'
import { AmqpRequest } from '../../../shared/models/requests/AmqpRequest'

/**
 * Class resolver for `decomposeForPersistence` — maps each walked item
 * to its concrete class so the decomposer can honour
 * `@NonSerialised` / `@TreatEmptyAsUndefined` even when the tree has
 * been JSON-round-tripped (all items end up POJOs after the defensive
 * structuredClone we do for the IPC payload).
 */
const restormClassResolver = (item: Record<string, unknown>, parentClass: object | undefined, propKey: string): object | undefined => {
  // Environment.variables rows are KeyValues; without a KeyValue class
  // here the decomposer can't cleanse a row.
  if (parentClass === EnvironmentClass && propKey === 'variables') return KeyValueClass
  // Environment.subEnvironments → nested Environment.
  if (parentClass === EnvironmentClass && propKey === 'subEnvironments') return EnvironmentClass
  // EnvironmentFolder.environments → Environment.
  if (parentClass === EnvironmentFolderClass && propKey === 'environments') return EnvironmentClass

  const type = item['type']
  if (type === 'http') return HTTPRequest
  if (type === 'soap') return SoapRequest
  if (type === 'grpc') return GrpcRequest
  if (type === 'graphql') return GraphQLRequest
  if (type === 'websocket') return WebSocketRequest
  if (type === 'sse') return SseRequest
  if (type === 'odata') return ODataRequest
  if (type === 'auth') return AuthenticationRequest
  if (type === 'amqp') return AmqpRequest
  // A design is a leaf save unit of its own: without this arm it would
  // fall through to the folder branch below and be decomposed (and
  // cleansed) as a Folder — a shape the save-unit bridge never produces,
  // so its drafts would never match and the unit would stay dirty.
  if (type === 'design') return ApiDesignClass
  // A recording session is its own save unit too (its deduced routes are
  // ordinary child units, walked like a scenario's).
  if (type === 'recording') return RecordingSessionClass
  // Everything without a `type` discriminator is a folder-like node.
  // Descendants of an EnvironmentFolder are regular Folders; everything
  // under a Folder stays a Folder.
  if (parentClass === EnvironmentFolderClass || parentClass === FolderClass) return FolderClass
  return undefined
}
import { DocumentEvents, type DocumentChangedPayload } from '../services/DocumentEvents'
import { searchIndexService } from '../services/SearchIndexService'
import { makeReactiveFolder, makeReactiveRequest, makeReactiveApiDesign, makeReactiveRecordingSession, emitEnvironmentUpdated } from '../types/reactive'
import {
  prepareForSerialization,
  processAfterDeserialization,
  cloneDocumentForSerialization,
  stringifyDocument,
  ProjectTooLargeError
} from '../utils/serialization'
import { isSaveCancellation } from '../../../shared/utils/saveResult'
import { cloneForEventBus } from '../utils/cloneForEventBus'
import {
  requiredFileFormatVersion,
  resolveFileFormatVersion,
} from '../../../shared/config/fileFormatVersion'
import type { EnvironmentFolder, FolderItem, Environment } from '../../../shared/types/collections'
import { isEnvironmentFolder, isScenario, isApiDesign, isRecordingSession } from '../../../shared/types/collections'
import type { PersistenceFormat, WorkbenchTree } from 'electron-core-ui/renderer'
import { collectEnvFileSecretsFromCollections, applyEnvFileSecretsToCollections } from '../../../shared/utils/envFileSecrets'
import { envSecretsDigestOf, findNodeByRuntimeId } from '../services/envSecretsDigest'
import { serializeEnvFile, parseEnvFileDetailed } from '../../../shared/utils/dotenv'
import type { TFunction } from 'i18next'

export interface UseFileManagementOptions {
  rootItems: FolderItem[]
  setRootItems: React.Dispatch<React.SetStateAction<FolderItem[]>>
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
  clearTabDirtyState: () => void
  markAllTabsSaved: () => void
  t: TFunction
}

export interface UseFileManagementReturn {
  // File menu handlers
  handleMenuNew: () => Promise<void>
  handleMenuOpen: () => Promise<void>
  handleMenuSave: () => Promise<boolean>
  handleMenuSaveAll: () => Promise<boolean>
  handleMenuSaveUnit: (runtimeId: string) => Promise<boolean>
  handleMenuSaveAs: () => void
  handleMenuClose: () => Promise<void>
  handleOpenRecentFile: (path: string) => Promise<void>
  // File event handlers
  handleFileOpened: (state: { currentFile: { content: unknown; path?: string | null; format?: string } }) => void
  handleFileClosed: () => void
}

export function useFileManagement(options: UseFileManagementOptions): UseFileManagementReturn {
  const {
    rootItems,
    setRootItems,
    setWorkbenchTree,
    clearTabDirtyState,
    markAllTabsSaved,
    t
  } = options

  const {
    state: _fileState,
    fileName,
    filePath,
    isDirty,
    open: openFile,
    save: saveFile,
    close: closeFile,
    showUnsavedChangesDialog
  } = useFileService()

  // Track loading state
  const lastLoadedPathRef = useRef<string | null>(null)
  const isLoadingRef = useRef(false)

  /**
   * Renderer-owned snapshot of the in-memory tree at the last
   * successful save / file-open. Used by the edit-then-revert
   * self-heal to detect "the tree is back to its saved baseline"
   * without going through the main-process `hasContentChanged`
   * (which mixes shapes — `FileService.save` stamps the stored
   * checksum with `preserveUuidMetadata`'s output, but the renderer
   * compares against a plain `{collections}` shape, so the
   * round-trip never matches). Comparing here, with the same shape
   * on both sides, gives the clean revert signal we need.
   */
  const savedBaselineRef = useRef<string | null>(null)

  /**
   * Separate baseline for the password-sidecar content (`.restorm.env`
   * for single-file mode, `restorm.env` for folder mode). Password
   * values are intentionally stripped by `SecretValue.toJSON()`
   * before persistence — which means they also disappear from the
   * `JSON.stringify`-based whole-doc checksum used by
   * `hasContentChanged`. Typing a JWT into an env-folder password
   * field therefore looks like a no-op to the main-doc checksum, and
   * the autosave path skips the sidecar write — the secret never
   * lands on disk. Tracking the sidecar content separately lets the
   * save flow notice "the main doc didn't change but a password did"
   * and still flush `.env`.
   */
  const savedEnvBaselineRef = useRef<string | null>(null)

  /**
   * The document as it is persisted: the format version at the root,
   * then the collections. Every save payload and every whole-file
   * checksum goes through here, so the shape compared at load is the
   * shape written at save.
   *
   * The version is DERIVED from the content being written
   * (`requiredFileFormatVersion`): a document using no version-gated
   * feature declares the base version whatever it declared on disk, and
   * the first save carrying an API design is the one that moves the
   * file to 1.1 — the lazy bump. Deriving rather than carrying the
   * loaded value forward is also what keeps the version correct in both
   * directions (removing the last design moves the next save back
   * down), and keeps open→save a fixed point on any file.
   */
  const buildDocument = useCallback(
    (collections: unknown[]): Record<string, unknown> => ({
      fileFormatVersion: requiredFileFormatVersion(collections),
      collections
    }),
    []
  )

  /**
   * Compose a stable pseudo-folder name for a root collection. The
   * decomposer only needs it so child `parentId` chains and
   * `runtimeId → unit` lookups stay consistent across roots — nothing
   * is written at these paths.
   */
  const rootFolderName = useCallback(
    (root: Record<string, unknown>, rootIdx: number, rootCount: number): string => {
      const paddingWidth = rootCount <= 0 ? 1 : String(rootCount).length
      const paddedIndex = String(rootIdx + 1).padStart(paddingWidth, '0')
      const rawName = typeof root['name'] === 'string' ? root['name'] : `Collection_${rootIdx + 1}`
      const safeName = rawName
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100)
      return `${paddedIndex} - ${safeName}`
    },
    []
  )

  const joinFolderPath = useCallback((a: string, b: string): string => {
    if (!a) return b
    if (!b) return a
    const sep = a.includes('\\') && !a.includes('/') ? '\\' : '/'
    const endsWithSep = a.endsWith('/') || a.endsWith('\\')
    return endsWithSep ? `${a}${b}` : `${a}${sep}${b}`
  }, [])

  /**
   * Walk `rootItems` with the decomposer and seed the save-unit registry
   * with one entry per unit-bearing descendant.
   *
   * Called at project open (so per-unit dirty dots start clean + draft
   * comparison has a reference) AND after a successful whole-file save
   * (to mark every unit clean in lockstep).
   *
   * The `absolutePath` values produced by the decomposer aren't
   * meaningful — the save-unit API ignores them for hydration, so we use
   * the file path itself (or an empty string if unknown) as the walk's
   * `basePath`.
   */
  const hydrateSaveUnitsFromTree = useCallback(async (
    items: FolderItem[],
    /**
     * Optional basePath / format overrides. Pass these from
     * `handleFileOpened` where the freshly-known path is in scope but
     * the closure's `filePath` hasn't yet
     * propagated through React's render cycle — without them, the
     * walker computes `basePath = ''`, the early-out fires, and leaf
     * units stay unhydrated. The first upsert from a user edit then
     * takes the `create` path (no reference), making subsequent
     * reverts undetectable until a Ctrl+S re-runs hydration with
     * settled state. Post-save callers omit the overrides and
     * continue to read from the closure.
     */
    overrides?: { basePath?: string; format?: PersistenceFormat }
  ): Promise<void> => {
    const basePath = overrides?.basePath ?? filePath ?? ''
    if (!basePath) return
    const fmt = overrides?.format ?? 'yaml'
    try {
      // Duplicate-import guard: two imports of the same spec produce root
      // folders with identical descendant ids (envs, requests, …). A naïve
      // iteration hydrates each id twice and the second wipe reverts the
      // reference to whichever sibling root was processed last — which
      // is usually the pristine one (the UI only mutates the first
      // occurrence). Keep only the first unit per id so the reference
      // matches the tree the user actually edits.
      const seen = new Set<string>()
      const rootCount = items.length
      for (let rootIdx = 0; rootIdx < rootCount; rootIdx += 1) {
        const root = items[rootIdx]
        if (!root) continue
        const rootPojo = cloneDocumentForSerialization(root) as unknown as Record<string, unknown>
        const rootClass: object = root instanceof EnvironmentFolderClass
          ? EnvironmentFolderClass
          : root instanceof FolderClass
            ? FolderClass
            : EnvironmentFolderClass
        // Same root-folder wrapping as `getOrBuildUnitMap` /
        // `buildFileModeDecomposition` so the hydrated `reference`
        // content matches what per-unit save would produce.
        const rootBasePath = joinFolderPath(basePath, rootFolderName(rootPojo, rootIdx, rootCount))
        const decomposed = decomposeForPersistence({
          root: rootPojo,
          rootClass,
          basePath: rootBasePath,
          format: fmt,
          extension: fmt,
          classResolver: restormClassResolver,
          indexPaddingMin: 1
        })
        const all: DecomposedUnit[] = [decomposed.rootIndex, ...decomposed.children]
        // Batch the IPC round-trips: `hydrateSaveUnit` is independent
        // per-unit (no inter-unit ordering), so running them in
        // parallel keeps file-open under a single render frame even
        // for a tree with dozens of leaves. Sequential awaits would
        // pile up enough latency to race with the env-context
        // initialisation that follows in `handleFileOpened` (the
        // URL resolver reads from the context that
        // `clearAll` + `ENVIRONMENT_CREATED` sets up after this hook).
        const pending: Promise<void>[] = []
        for (const unit of all) {
          if (!unit.runtimeId) continue
          if (seen.has(unit.runtimeId)) continue
          seen.add(unit.runtimeId)
          // Mirror `doUpsert`'s digest stamp on the REFERENCE side: the
          // decomposed content is plaintext-stripped, so without the digest
          // a later secret-only draft would either always or never differ.
          const liveNode = findNodeByRuntimeId(items, unit.runtimeId)
          const digest = liveNode ? envSecretsDigestOf(liveNode) : null
          const reference = digest !== null
            ? { ...unit.content, __envSecretsDigest: digest }
            : unit.content
          pending.push(hydrateSaveUnit({
            runtimeId: unit.runtimeId,
            kind: unit.kind,
            reference,
            ...(unit.parentId !== undefined && { parentId: unit.parentId })
          }))
        }
        await Promise.all(pending)
      }
    } catch (err) {
      logger.warn('[useFileManagement] Save-unit hydration failed', { error: String(err) })
    }
  }, [filePath, rootFolderName, joinFolderPath])

  // A project whose serialized form exceeds the max JS string length cannot
  // be written to disk. Tell the user plainly instead of failing silently or
  // crashing the renderer with an unhandled RangeError.
  const notifyProjectTooLarge = useCallback((): void => {
    toasterService.push('app', {
      title: t('file.projectTooLarge.title'),
      body: t('file.projectTooLarge.body'),
      durationMs: 8000
    })
  }, [t])

  // Save handlers
  const handleMenuSave = useCallback(async (): Promise<boolean> => {
    let plainData: Record<string, unknown>
    let dataForChecksum: Record<string, unknown>
    let currentChecksum: string
    try {
      plainData = cloneDocumentForSerialization(buildDocument(rootItems))
      dataForChecksum = prepareForSerialization(plainData)
      currentChecksum = stringifyDocument(dataForChecksum)
    } catch (error) {
      if (error instanceof ProjectTooLargeError) {
        notifyProjectTooLarge()
        return false
      }
      throw error
    }
    const hasRealChanges = await hasContentChanged(currentChecksum)

    // Collect from the live in-memory tree (not `plainData`).
    // `JSON.parse(JSON.stringify(rootItems))` runs every
    // `SecretValue.toJSON()`, which strips the plaintext —
    // collecting from `plainData` would always see an empty
    // string for every secret, even when the user just typed
    // a real value. The live tree still holds the plaintext on
    // the `SecretValue` instances (their non-persisted `resolved`
    // field); the walker reads it off both class instances and the
    // POJO shape so it works on either.
    const secrets = collectEnvFileSecretsFromCollections({ collections: rootItems })
    const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
    const hasEnvChanged = envContent !== (savedEnvBaselineRef.current ?? '')

    if (hasRealChanges) {
      const saved = await saveFile(dataForChecksum)
      if (!saved) return false
    }
    // Always write `.env` when its content drifted from the last
    // saved baseline, even if `hasContentChanged` reports no main-doc
    // delta. The main-doc checksum can't see password edits (toJSON
    // strips them), so password-only changes go through this branch.
    if (filePath && (hasRealChanges || hasEnvChanged)) {
      await window.restorm?.secrets.write(`${filePath}.env`, envContent)
      savedEnvBaselineRef.current = envContent
    }
    // Force-clean the save-unit registry on EVERY save-all path — a real save, a
    // password-only `.env` write, or a no-op clean — so delete tombstones (a
    // removed top-level env / request) never outlive the save that made them moot.
    await window.restorm?.file.clearDrafts()
    void setContentChecksum(currentChecksum)
    savedBaselineRef.current = currentChecksum
    markAllTabsSaved()
    await hydrateSaveUnitsFromTree(rootItems)
    return true
  }, [saveFile, rootItems, filePath, markAllTabsSaved, hydrateSaveUnitsFromTree, buildDocument, notifyProjectTooLarge])

  const handleMenuSaveAll = handleMenuSave

  /**
   * Per-unit decomposition: the `absolutePath` on each `DecomposedUnit`
   * is meaningless — we only care about `runtimeId`, `kind`, `parentId`
   * and `content` for registry hydration. Used by per-unit Ctrl+S to
   * identify a subtree of units to commit when the whole file has been
   * rewritten.
   */
  const buildFileModeDecomposition = useCallback((): Map<string, DecomposedUnit> => {
    const units = new Map<string, DecomposedUnit>()
    const rootCount = rootItems.length
    rootItems.forEach((root, rootIdx) => {
      const rootPojo = cloneDocumentForSerialization(root) as unknown as Record<string, unknown>
      const rootClass: object = root instanceof EnvironmentFolderClass
        ? EnvironmentFolderClass
        : root instanceof FolderClass
          ? FolderClass
          : EnvironmentFolderClass
      // `absolutePath` is meaningless but we still wrap each root in its
      // own pseudo-folder so child `parentId` chains and
      // `runtimeId → unit` lookups are consistent across roots.
      const rootBasePath = joinFolderPath(filePath ?? '', rootFolderName(rootPojo, rootIdx, rootCount))
      const decomposed = decomposeForPersistence({
        root: rootPojo,
        rootClass,
        basePath: rootBasePath,
        format: 'yaml',
        extension: 'yaml',
        classResolver: restormClassResolver,
        indexPaddingMin: 1
      })
      units.set(decomposed.rootIndex.runtimeId, decomposed.rootIndex)
      for (const child of decomposed.children) units.set(child.runtimeId, child)
    })
    return units
  }, [rootItems, filePath, rootFolderName, joinFolderPath])

  /**
   * Collect the set of save-unit ids to commit for a given Ctrl+S target.
   * The rule mirrors what the user sees on the active tab — never more,
   * never less:
   *
   *   - Request tab (leaf): just the request.
   *   - Regular folder tab: just the folder document; child requests /
   *     sub-folders have their own tabs and their own Ctrl+S, so they
   *     stay dirty on Ctrl+S of the parent.
   *   - Env folder tab: folder document + every environment + every
   *     nested sub-environment. Variables are rendered on this tab
   *     even though each env is its own save unit,
   *     so the user's Ctrl+S has to reach them.
   *   - Environment / sub-environment (no direct tab, but included
   *     transitively via the env folder rule).
   *
   * Units the scanner never identified (stray ids) fall back to the
   * single-id set so at worst Ctrl+S is a no-op cascade-wise.
   */
  const collectSaveSubtreeIds = useCallback((runtimeId: string): Set<string> => {
    const ids = new Set<string>([runtimeId])
    interface EnvNode { id?: string; subEnvironments?: EnvNode[] }
    const addEnvSubtree = (env: EnvNode): void => {
      if (typeof env.id === 'string') ids.add(env.id)
      const subs = Array.isArray(env.subEnvironments) ? env.subEnvironments : []
      for (const sub of subs) addEnvSubtree(sub)
    }
    const walk = (item: unknown): boolean => {
      if (!item || typeof item !== 'object') return false
      const node = item as {
        id?: unknown
        environments?: unknown
        items?: unknown
        subEnvironments?: unknown
      }
      if (typeof node.id !== 'string') return false
      if (node.id === runtimeId) {
        if (Array.isArray(node.environments)) {
          for (const env of node.environments) addEnvSubtree(env as EnvNode)
        }
        if (Array.isArray(node.subEnvironments)) {
          for (const sub of node.subEnvironments) addEnvSubtree(sub as EnvNode)
        }
        return true
      }
      if (Array.isArray(node.items)) {
        for (const child of node.items) if (walk(child)) return true
      }
      if (Array.isArray(node.environments)) {
        for (const env of node.environments) if (walk(env)) return true
      }
      if (Array.isArray(node.subEnvironments)) {
        for (const sub of node.subEnvironments) if (walk(sub)) return true
      }
      return false
    }
    for (const root of rootItems) if (walk(root)) break
    return ids
  }, [rootItems])

  /**
   * Persist a single save unit (current tab) to disk. The subtree
   * included in the save is computed by `collectSaveSubtreeIds` above —
   * the tab's visible content, not every descendant document.
   */
  const handleMenuSaveUnit = useCallback(async (runtimeId: string): Promise<boolean> => {
    logger.info('[useFileManagement] handleMenuSaveUnit', { runtimeId })
    if (rootItems.length === 0) return false

    const subtreeIds = collectSaveSubtreeIds(runtimeId)
    const fileSubtreeIds = subtreeIds

    let fileUnits: Map<string, DecomposedUnit>
    let dataForChecksum: Record<string, unknown>
    let currentChecksum: string
    try {
      // Write the whole file, then re-hydrate only the subtree
      // so other dirty units stay dirty.
      fileUnits = buildFileModeDecomposition()
      const plainData = cloneDocumentForSerialization(buildDocument(rootItems))
      dataForChecksum = prepareForSerialization(plainData)
      currentChecksum = stringifyDocument(dataForChecksum)
    } catch (error) {
      if (error instanceof ProjectTooLargeError) {
        notifyProjectTooLarge()
        return false
      }
      throw error
    }
    const hasRealChanges = await hasContentChanged(currentChecksum)
    // No real disk delta → still commit the subtree's drafts so the
    // per-tab dirty dots clear. The user pressed Ctrl+S on this tab;
    // their expectation is "this tab is now saved".
    const saved = hasRealChanges ? await saveFile(dataForChecksum) : true
    if (!saved) return false
    if (filePath) {
      // Password values are stripped from the main-doc checksum by
      // `SecretValue.toJSON()`, so `hasRealChanges` can't see
      // password-only edits. Compare the sidecar content against
      // its own baseline and write `.env` whenever the secrets
      // changed, regardless of the main-doc verdict.
      const secrets = collectEnvFileSecretsFromCollections({ collections: rootItems })
      const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
      const hasEnvChanged = envContent !== (savedEnvBaselineRef.current ?? '')
      if (hasRealChanges || hasEnvChanged) {
        await window.restorm?.secrets.write(`${filePath}.env`, envContent)
        savedEnvBaselineRef.current = envContent
      }
    }
    // Re-baseline `hasContentChanged` to the renderer's shape so
    // post-save comparisons match (see `handleMenuSave` for the
    // full rationale).
    void setContentChecksum(currentChecksum)
    savedBaselineRef.current = currentChecksum
    // Hydrate only the subtree we just "committed". Other dirty units
    // keep their drafts so their tabs keep showing dirty dots even
    // though the on-disk file has their content too.
    for (const id of fileSubtreeIds) {
      const entry = fileUnits.get(id)
      if (!entry) continue
      await hydrateSaveUnit({
        runtimeId: entry.runtimeId,
        kind: entry.kind,
        reference: entry.content,
        ...(entry.parentId !== undefined && { parentId: entry.parentId })
      })
    }
    return true
  }, [rootItems, saveFile, filePath, buildFileModeDecomposition, collectSaveSubtreeIds, buildDocument, notifyProjectTooLarge])

  /**
   * Core save implementation shared by File → New and File → Save as.
   */
  const performSave = useCallback(
    async (intent: 'new' | 'saveAs', saveOptions: { format: PersistenceFormat }): Promise<void> => {
      const isNew = intent === 'new'
      try {
        const plainData = isNew
          // A brand-new document carries the stamp from its very first
          // save. Empty collections use no version-gated feature, so the
          // derived version is the base one — a new project stays openable
          // by every build.
          ? (buildDocument([]))
          : (cloneDocumentForSerialization(buildDocument(rootItems)))

        logger.info('[useFileManagement] Saving with options', {
          intent,
          format: saveOptions.format
        })

        const dataForSave = prepareForSerialization(plainData)
        const result = await window.restorm?.file.saveAsFile(dataForSave, saveOptions.format)
        if (result?.success) {
          logger.info('[useFileManagement] File saved successfully', { path: result.path })
          if (result.path) {
            const secrets = collectEnvFileSecretsFromCollections({ collections: rootItems })
            const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
            await window.restorm?.secrets.write(`${result.path}.env`, envContent)
            savedEnvBaselineRef.current = envContent
          }
          if (isNew && result.path) {
            await closeFile()
            await openFile(result.path)
          }
        } else if (isSaveCancellation(result)) {
          // The user dismissed the "Save as" dialog — a normal choice, not a
          // failure. Logging it as an error turns every cancel into a Sentry
          // event that drowns the real ones.
          logger.info('[useFileManagement] Save cancelled by the user')
        } else {
          logger.error('[useFileManagement] Failed to save file', {
            error: result?.error ?? 'Unknown error'
          })
        }
      } catch (error) {
        if (error instanceof ProjectTooLargeError) {
          notifyProjectTooLarge()
          return
        }
        logger.error('[useFileManagement] Save error', { error: String(error) })
      }
    },
    [rootItems, closeFile, openFile, buildDocument, notifyProjectTooLarge]
  )

  const handleMenuSaveAs = useCallback(() => {
    void performSave('saveAs', { format: 'yaml' })
  }, [performSave])

  const checkUnsavedChanges = useCallback(async (): Promise<boolean> => {
    let currentChecksum: string
    try {
      currentChecksum = stringifyDocument(prepareForSerialization(buildDocument(rootItems)))
    } catch (error) {
      if (error instanceof ProjectTooLargeError) {
        notifyProjectTooLarge()
        return false
      }
      throw error
    }
    const hasRealChanges = await hasContentChanged(currentChecksum)

    if (!hasRealChanges) return true

    const result = await showUnsavedChangesDialog({
      title: t('file.unsavedChanges.title'),
      message: t('file.unsavedChanges.message', { fileName: fileName ?? t('file.untitled') }),
      detail: t('file.unsavedChanges.detail'),
      save: t('file.unsavedChanges.save'),
      dontSave: t('file.unsavedChanges.dontSave'),
      cancel: t('file.unsavedChanges.cancel')
    })
    if (result === 'cancel') return false
    if (result === 'save') {
      let dataForSave: unknown
      try {
        dataForSave = prepareForSerialization(cloneDocumentForSerialization(buildDocument(rootItems)) as unknown)
      } catch (error) {
        if (error instanceof ProjectTooLargeError) {
          notifyProjectTooLarge()
          return false
        }
        throw error
      }
      const saved = await saveFile(dataForSave)
      if (saved && filePath) {
        const secrets = collectEnvFileSecretsFromCollections({ collections: rootItems })
        const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
        await window.restorm?.secrets.write(`${filePath}.env`, envContent)
      }
      return saved
    }
    // Discard branch: the user explicitly chose to throw away their
    // changes. Wipe the project's drafts directory before letting the
    // close proceed — otherwise per-unit drafts that the registry
    // failed to delete (sameShape misses, races, …) survive on disk
    // and the next launch reads them as a recovery candidate.
    await window.restorm?.file.clearDrafts()
    return true
  }, [showUnsavedChangesDialog, rootItems, saveFile, t, fileName, filePath, buildDocument, notifyProjectTooLarge])

  const handleMenuNew = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      void performSave('new', { format: 'yaml' })
    }
  }, [checkUnsavedChanges, performSave])

  const handleMenuOpen = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      await openFile()
    }
  }, [checkUnsavedChanges, openFile])

  const handleMenuClose = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      await closeFile()
    }
  }, [checkUnsavedChanges, closeFile])

  const handleOpenRecentFile = useCallback(
    async (path: string) => {
      const canProceed = await checkUnsavedChanges()
      if (canProceed) {
        await closeFile()
        await openFile(path)
      }
    },
    [checkUnsavedChanges, closeFile, openFile]
  )

  // Handle file opened event
  const handleFileOpened = useCallback(
    (state: { currentFile: { content: unknown; path?: string | null; format?: string; name?: string } }) => {
      void (async () => {
        const newPath = state.currentFile.path ?? null

        if (isLoadingRef.current && newPath === lastLoadedPathRef.current) {
          return
        }

        isLoadingRef.current = true
        lastLoadedPathRef.current = newPath

        const path = state.currentFile.path ?? ''

        const content = state.currentFile.content as Record<string, unknown> | null
        let openedEnvContent = ''
        if (content && path) {
          const envText = await window.restorm?.secrets.read(`${path}.env`)
          if (envText) {
            openedEnvContent = envText
            const parsed = parseEnvFileDetailed(envText)
            if (parsed.duplicates.length > 0) {
              logger.warn('[useFileManagement] Duplicate keys found in .restorm.env (last wins)', {
                duplicates: parsed.duplicates
              })
            }
            applyEnvFileSecretsToCollections(content, parsed.vars)
          }
        }
        // Capture the loaded env content as the sidecar baseline so
        // the save flow's "did the secrets change since load?" check
        // has a reference point. Without this, the first save after
        // a fresh load would always re-write `.env` (harmless but
        // wasteful), and a later edit-then-revert wouldn't quiet.
        savedEnvBaselineRef.current = openedEnvContent

        const collectionsRaw = (content as { collections?: unknown } | null)?.collections
        const collections = Array.isArray(collectionsRaw) ? (collectionsRaw as EnvironmentFolder[]) : []

        clearTabDirtyState()

        // The document's format version is content-derived at save time;
        // resolving it here is kept for its gate-bypass warning (a future
        // version reaching this point means a load path skipped the
        // compatibility gate).
        resolveFileFormatVersion(content, logger)

        const collectionsWithIds = processAfterDeserialization(collections)
        // Requests can legally live at the root (see `useImport`'s
        // empty-file branch). Folders and env-folders go through
        // `makeReactiveFolder`; root-level requests go through
        // `makeReactiveRequest` with no parent id so edits still emit
        // `REQUEST_UPDATED` into the dirty tracker / search index.
        // Designs go through `makeReactiveApiDesign` so their edits emit
        // `DESIGN_UPDATED` into the same pipeline.
        const reactiveItems = collectionsWithIds.map((item) =>
          isApiDesign(item) ? makeReactiveApiDesign(item) : isRecordingSession(item) ? makeReactiveRecordingSession(item) : 'items' in item ? makeReactiveFolder(item) : makeReactiveRequest(item)
        )
        setRootItems(reactiveItems)

        // Save-unit hydration is deferred to the end of this hook so
        // env-context registration (`clearAll` → `ENVIRONMENT_CREATED`
        // → request register) gets the IPC channel first. Without
        // that, the URL resolver can race the bridge and serve a tab
        // before its env's variables have been published.

        // Whole-file checksum baseline — still used by `hasContentChanged`
        // to skip redundant saves when nothing has been touched. Per-object
        // dirty state lives in the save-unit registry now, so we no longer
        // feed a parallel checksum map.
        try {
          const baselineChecksum = stringifyDocument(prepareForSerialization(buildDocument(reactiveItems)))
          void setContentChecksum(baselineChecksum)
          savedBaselineRef.current = baselineChecksum
        } catch (error) {
          // A project too large to serialize can still be opened, but it has
          // no save baseline — tell the user, and leave the baseline unset so
          // `hasContentChanged` treats it as dirty rather than crashing open.
          if (error instanceof ProjectTooLargeError) {
            notifyProjectTooLarge()
          } else {
            throw error
          }
        }

        await searchIndexService.clearIndex()
        await window.restorm?.context.clearAll()

        const emitEnvironmentCreated = (
          env: Environment,
          parentFolderId: string,
          parentEnvironmentId?: string
        ): void => {
          const payload: DocumentChangedPayload = {
            id: env.id,
            type: 'environment',
            // `cloneForEventBus` instead of `JSON.parse(JSON.stringify(...))`:
            // `SecretValue.toJSON()` strips the plaintext, so without
            // this every secret loaded from the sidecar `.restorm.env`
            // would reach main-side ContextService as `""` — handlebars
            // would then resolve `{{token}}` to an empty string at
            // execution time even though the on-disk state is correct.
            document: cloneForEventBus(env),
            parentFolderId,
            parentEnvironmentId
          }
          eventBus.emitSync(DocumentEvents.ENVIRONMENT_CREATED, payload)
          if (env.subEnvironments) {
            for (const subEnv of env.subEnvironments) {
              emitEnvironmentCreated(subEnv, parentFolderId, env.id)
            }
          }
        }

        for (const rootItem of reactiveItems) {
          if (isEnvironmentFolder(rootItem)) {
            for (const env of rootItem.environments) {
              emitEnvironmentCreated(env, rootItem.id)
            }
          }
        }

        await searchIndexService.initialize()
        for (const rootItem of reactiveItems) {
          // `indexFolderTree` walks folders recursively; scenarios go
          // through their own indexer so the scenario itself + its
          // child requests are tagged with the right category; requests
          // at the root need their own indexing path (no parent folder
          // to hand off to).
          if (isScenario(rootItem)) {
            await searchIndexService.indexScenarioTree(rootItem)
          } else if (isApiDesign(rootItem)) {
            // A design indexes itself + its models/enums/routes as
            // sub-entries of the design category.
            await searchIndexService.indexDesign(rootItem)
          } else if (isRecordingSession(rootItem)) {
            await searchIndexService.indexRecordingTree(rootItem)
          } else if ('items' in rootItem) {
            await searchIndexService.indexFolderTree(rootItem)
          } else {
            await searchIndexService.indexRootRequest(rootItem)
          }
        }

        // Hydrate the save-unit registry now that the env-context
        // pipeline has finished publishing its data. The `path` here
        // is the freshly-known one — the closure's `filePath` still
        // holds its previous render's value until React re-renders.
        if (path) {
          const fmt = (state.currentFile.format as PersistenceFormat | undefined) ?? 'yaml'
          await hydrateSaveUnitsFromTree(reactiveItems, { basePath: path, format: fmt })
        }

        await finishLoading()

        isLoadingRef.current = false
      })()
    },
    [clearTabDirtyState, setRootItems, hydrateSaveUnitsFromTree, buildDocument, notifyProjectTooLarge]
  )

  // Silent sidecar reload. `<project>.restorm.env` is read once at open
  // and held in memory (SecretValue instances + save baseline + main-side
  // env context), then REWRITTEN FROM MEMORY on save — an external edit
  // would be invisible and overwritten. The main watcher signals it; the
  // policy here is a SILENT re-apply (no prompt — unlike the project
  // file, reloading secret values cannot discard structural in-app work).
  useEffect(() => window.restorm?.secrets.onExternallyChanged(() => {
    void (async () => {
      const path = filePath
      if (!path) return
      const envText = (await window.restorm?.secrets.read(`${path}.env`)) ?? ''
      if (envText === savedEnvBaselineRef.current) return
      const parsed = parseEnvFileDetailed(envText)
      if (parsed.duplicates.length > 0) {
        logger.warn('[useFileManagement] Duplicate keys in externally-changed .restorm.env (last wins)', {
          duplicates: parsed.duplicates
        })
      }
      // In-place: the SecretValue instances on the live reactive tree get
      // the fresh plaintext (an absent key blanks its value).
      applyEnvFileSecretsToCollections({ collections: rootItems }, parsed.vars)
      savedEnvBaselineRef.current = envText
      // The in-place class-field mutation emits nothing — re-publish every
      // environment so the main-side context (Handlebars resolution) sees
      // the new values.
      const republish = (env: Environment, parentFolderId: string, parentEnvironmentId?: string): void => {
        emitEnvironmentUpdated(env, parentFolderId, parentEnvironmentId)
        if (env.subEnvironments) {
          for (const subEnv of env.subEnvironments) republish(subEnv, parentFolderId, env.id)
        }
      }
      for (const rootItem of rootItems) {
        if (isEnvironmentFolder(rootItem)) {
          for (const env of rootItem.environments) republish(env, rootItem.id)
        }
      }
      logger.info('[useFileManagement] Secrets sidecar reloaded after an external change')
    })()
  }) ?? undefined, [filePath, rootItems])

  // Handle file closed event
  const handleFileClosed = useCallback(() => {
    isLoadingRef.current = false
    lastLoadedPathRef.current = null
    setWorkbenchTree({
      orientation: 'vertical',
      groups: []
    })
    setRootItems([])
    void searchIndexService.clearIndex()
    void window.restorm?.context.clearAll()
    clearTabDirtyState()
  }, [clearTabDirtyState, setWorkbenchTree, setRootItems])

  // Self-heal stuck dirty state on whole-file revert. When the user
  // edits then undoes a change, the per-unit `mutate()` should detect
  // the revert via its `sameShape` deep-equal check and drop the draft
  // — but a serialization asymmetry between the hydrate path
  // (`decomposeForPersistence`) and the upsert path
  // (`cleanseForPersistence` + `classForDocument`) can make the two
  // shapes disagree on edge cases (key ordering across nested
  // structures, numeric encodings, … any divergence the deep-equal
  // can't paper over). The whole-file checksum is the ground truth:
  // if the in-memory tree matches the saved baseline, by definition
  // no unit can legitimately be dirty. Bulk-clear when registry says
  // dirty but the baseline matches.
  useEffect(() => {
    if (!isDirty) return
    if (rootItems.length === 0) return
    const baseline = savedBaselineRef.current
    if (baseline === null) return
    const timer = setTimeout(() => {
      void (async () => {
        let currentChecksum: string
        try {
          currentChecksum = stringifyDocument(prepareForSerialization(buildDocument(rootItems)))
        } catch (error) {
          // Background dirty-dot reconciliation: if the project is too large
          // to serialize there is nothing to reconcile and no user action to
          // report. Swallow it so it never surfaces as an unhandled rejection
          // out of this timer — a real save reports the size problem to the
          // user with a clear toast.
          if (error instanceof ProjectTooLargeError) return
          throw error
        }
        if (currentChecksum !== baseline) return
        // The whole-file checksum is BLIND to secret plaintexts (toJSON
        // strips them): a freshly typed secret value leaves the checksum
        // at the baseline while the SIDECAR genuinely changed. Clearing
        // the drafts here would kill the dirty transition the autosave is
        // waiting on — and the .env write would never happen.
        const secrets = collectEnvFileSecretsFromCollections({ collections: rootItems })
        const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
        if (envContent !== (savedEnvBaselineRef.current ?? '')) return
        await window.restorm?.file.clearDrafts()
      })()
    }, 200)
    return () => { clearTimeout(timer) }
  }, [rootItems, isDirty, buildDocument])

  // Save-and-close handler
  useEffect(() => {
    const handleSaveAndClose = async (): Promise<void> => {
      let dataForSave: unknown
      try {
        dataForSave = prepareForSerialization(cloneDocumentForSerialization(buildDocument(rootItems)) as unknown)
      } catch (error) {
        if (error instanceof ProjectTooLargeError) {
          // Can't serialize to save-then-close: tell the user and DON'T
          // force the window closed, so their work isn't lost to a close
          // they can't complete.
          notifyProjectTooLarge()
          return
        }
        throw error
      }
      const saved = await saveFile(dataForSave)
      if (saved) {
        if (filePath) {
          const secrets = collectEnvFileSecretsFromCollections({ collections: rootItems })
          const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
          await window.restorm?.secrets.write(`${filePath}.env`, envContent)
        }
        await window.restorm?.forceClose()
      }
    }

    const cleanup = window.restorm?.onSaveAndClose(() => {
      void handleSaveAndClose()
    })

    return cleanup
  }, [rootItems, saveFile, filePath, buildDocument, notifyProjectTooLarge])

  return {
    handleMenuNew,
    handleMenuOpen,
    handleMenuSave,
    handleMenuSaveAll,
    handleMenuSaveUnit,
    handleMenuSaveAs,
    handleMenuClose,
    handleOpenRecentFile,
    handleFileOpened,
    handleFileClosed
  }
}
