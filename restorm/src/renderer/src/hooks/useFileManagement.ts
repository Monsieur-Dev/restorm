/**
 * Hook for managing file operations (open, save, close)
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useFileService,
  setContentChecksum,
  finishLoading,
  hasContentChanged,
  eventBus,
  logger,
  computeChecksum,
  saveUnitToDisk,
  decomposeForPersistence,
  hydrateSaveUnit,
  type DecomposedUnit
} from 'electron-core-ui/renderer'
import { Folder as FolderClass } from '../../../shared/models/Folder'
import { EnvironmentFolder as EnvironmentFolderClass } from '../../../shared/models/EnvironmentFolder'
import { Environment as EnvironmentClass } from '../../../shared/models/Environment'
import { KeyValue as KeyValueClass } from '../../../shared/models/KeyValue'
import { HTTPRequest } from '../../../shared/models/requests/HTTPRequest'
import { SoapRequest } from '../../../shared/models/requests/SoapRequest'
import { GrpcRequest } from '../../../shared/models/requests/GrpcRequest'
import { GraphQLRequest } from '../../../shared/models/requests/GraphQLRequest'
import { WebSocketRequest } from '../../../shared/models/requests/WebSocketRequest'
import { ODataRequest } from '../../../shared/models/requests/ODataRequest'
import { AuthenticationRequest } from '../../../shared/models/requests/AuthenticationRequest'

/**
 * Class resolver for `decomposeForPersistence` — maps each walked item
 * to its concrete class so the decomposer can honour
 * `@NonSerialised` / `@TreatEmptyAsUndefined` even when the tree has
 * been JSON-round-tripped (all items end up POJOs after the defensive
 * structuredClone we do for the IPC payload).
 */
const restormClassResolver = (item: Record<string, unknown>, parentClass: object | undefined, propKey: string): object | undefined => {
  // Environment.variables is `@separateFiles` — each row is a KeyValue
  // that needs its own file. Without a KeyValue class here, the
  // decomposer can't cleanse the row or name the file.
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
  if (type === 'odata') return ODataRequest
  if (type === 'auth') return AuthenticationRequest
  // Everything without a `type` discriminator is a folder-like node.
  // Descendants of an EnvironmentFolder are regular Folders; everything
  // under a Folder stays a Folder.
  if (parentClass === EnvironmentFolderClass || parentClass === FolderClass) return FolderClass
  return undefined
}
import { DocumentEvents, type DocumentChangedPayload } from '../services/DocumentEvents'
import { searchIndexService } from '../services/SearchIndexService'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
import { prepareForSerialization, processAfterDeserialization } from '../utils/serialization'
import { cloneForEventBus } from '../utils/cloneForEventBus'
import { normalizeFileFormatVersion } from '../../../shared/config/fileFormatVersion'
import type { Folder, EnvironmentFolder, Request, FolderItem, Environment } from '../../../shared/types/collections'
import { isEnvironmentFolder, isAnyFolder } from '../../../shared/types/collections'
import type { PersistenceFormat, WorkbenchTree } from 'electron-core-ui/renderer'
import type { SaveOptions } from '../components/Modals/SaveOptionsModal'
import { collectPasswordSecretsFromCollections, applyPasswordSecretsToCollections } from '../../../shared/utils/passwordSecrets'
import { serializeEnvFile, parseEnvFileDetailed } from '../../../shared/utils/dotenv'
import type { TFunction } from 'i18next'

export interface UseFileManagementOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  setRootItems: React.Dispatch<React.SetStateAction<(EnvironmentFolder | Folder | Request)[]>>
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
  clearTabDirtyState: () => void
  registerTabDirtyState: (id: string, checksum: string) => void
  markAllTabsSaved: () => void
  t: TFunction
}

export interface UseFileManagementReturn {
  // File menu handlers
  handleMenuNew: () => Promise<void>
  handleMenuOpen: () => Promise<void>
  handleMenuOpenFolder: () => Promise<void>
  handleMenuSave: () => Promise<boolean>
  handleMenuSaveAll: () => Promise<boolean>
  handleMenuSaveUnit: (runtimeId: string) => Promise<boolean>
  handleMenuSaveAs: () => void
  handleMenuClose: () => Promise<void>
  handleOpenRecentFile: (path: string) => Promise<void>
  handleSaveWithOptions: (options: SaveOptions) => Promise<void>
  // File event handlers
  handleFileOpened: (state: { currentFile: { content: unknown; path?: string | null; format?: string } }) => void
  handleFileClosed: () => void
  // File state
  isOpenedAsFolder: boolean
  setIsOpenedAsFolder: React.Dispatch<React.SetStateAction<boolean>>
  folderFormat: PersistenceFormat
  setFolderFormat: React.Dispatch<React.SetStateAction<PersistenceFormat>>
  currentFolderPath: string | null
  setCurrentFolderPath: React.Dispatch<React.SetStateAction<string | null>>
  // Modals
  showSaveOptionsModal: boolean
  setShowSaveOptionsModal: (show: boolean) => void
}

export function useFileManagement(options: UseFileManagementOptions): UseFileManagementReturn {
  const {
    rootItems,
    setRootItems,
    setWorkbenchTree,
    clearTabDirtyState,
    registerTabDirtyState,
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

  const [showSaveOptionsModal, setShowSaveOptionsModal] = useState(false)
  const [saveOptionsIntent, setSaveOptionsIntent] = useState<'saveAs' | 'new'>('saveAs')
  const [isOpenedAsFolder, setIsOpenedAsFolder] = useState(false)
  const [folderFormat, setFolderFormat] = useState<PersistenceFormat>('yaml')
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null)

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
   * Compose the on-disk folder name for a root collection the exact
   * same way `saveFolderStructure` does in the main process — that's
   * the function that physically lays out the workspace at save-all
   * time, so per-unit saves (`handleMenuSaveUnit`) must stay aligned
   * with its naming scheme or they end up writing to a parallel,
   * orphan hierarchy. `getPaddingWidth` matches the main-side helper
   * (`max(1, digits)`) — different from the generic decomposer default
   * (`max(2, digits)`) which would produce "01 - …" where
   * `saveFolderStructure` produces "1 - …".
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
   * with one entry per `@separateFiles` / `@separateFolders` descendant.
   *
   * Called at project open (so per-unit dirty dots start clean + draft
   * comparison has a reference) AND after a successful whole-file or
   * whole-folder save (to mark every unit clean in lockstep).
   *
   * In file mode the `absolutePath` values produced by the decomposer
   * aren't meaningful — the save-unit API ignores them for hydration,
   * so we use the file path itself (or an empty string if unknown) as
   * the walk's `basePath`.
   */
  const hydrateSaveUnitsFromTree = useCallback(async (
    items: (EnvironmentFolder | Folder | Request)[],
    /**
     * Optional basePath / format overrides. Pass these from
     * `handleFileOpened` where the freshly-known path is in scope but
     * the closure's `currentFolderPath` / `filePath` haven't yet
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
    const basePath = overrides?.basePath ?? currentFolderPath ?? filePath ?? ''
    if (!basePath) return
    const fmt = overrides?.format ?? folderFormat
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
        const rootPojo = JSON.parse(JSON.stringify(root)) as Record<string, unknown>
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
          pending.push(hydrateSaveUnit({
            runtimeId: unit.runtimeId,
            kind: unit.kind,
            reference: unit.content,
            ...(unit.parentId !== undefined && { parentId: unit.parentId })
          }))
        }
        await Promise.all(pending)
      }
    } catch (err) {
      logger.warn('[useFileManagement] Save-unit hydration failed', { error: String(err) })
    }
  }, [currentFolderPath, filePath, folderFormat, rootFolderName, joinFolderPath])

  // Save handlers
  const handleMenuSave = useCallback(async (): Promise<boolean> => {
    const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as Record<
      string,
      unknown
    >
    const dataForChecksum = prepareForSerialization(plainData)
    const currentChecksum = JSON.stringify(dataForChecksum)
    const hasRealChanges = await hasContentChanged(currentChecksum)

    if (isOpenedAsFolder && currentFolderPath) {
      if (hasRealChanges) {
        const result = await window.restorm?.file.saveAsFolder(
          plainData,
          folderFormat,
          currentFolderPath
        )
        if (!result?.success) return false
      } else {
        // No whole-file delta, but orphan `.draft.*` files may
        // still live under `userData/drafts/<uuid>/` from earlier
        // sessions or from runtime ids no longer in the tree. The
        // save-IPC paths bulk-clear drafts on success; mirror that
        // here so the post-save invariant "zero drafts on disk"
        // holds even when nothing on disk needed rewriting.
        await window.restorm?.file.clearDrafts()
      }
      // Re-baseline `hasContentChanged` to the just-saved tree
      // using the renderer's serialization shape. FileService.save
      // would otherwise stamp the checksum with `preserveUuidMetadata`'s
      // output (which appends projectUuid) — diverging from the
      // shape the renderer uses for every subsequent comparison and
      // making `hasContentChanged` permanently report `true`. That
      // breaks the edit-then-revert self-heal in `useEffect`s below.
      void setContentChecksum(currentChecksum)
      savedBaselineRef.current = currentChecksum
      markAllTabsSaved()
      // Re-hydrate the registry from the just-saved tree — every
      // unit's `reference` picks up the new value, every draft is
      // cleared, and the global isDirty flips off via the bridge.
      // Runs even when the file on disk was unchanged: per-unit Ctrl+S
      // may have left stale references on sibling units that this
      // save-all needs to flush.
      await hydrateSaveUnitsFromTree(rootItems)
      return true
    }

    if (hasRealChanges) {
      // Collect from the live in-memory tree (not `plainData`).
      // `JSON.parse(JSON.stringify(rootItems))` runs every
      // `PasswordValue.toJSON()`, which strips the plaintext —
      // collecting from `plainData` would always see an empty
      // string for every secret, even when the user just typed
      // a real value. The live tree still holds the plaintext on
      // the `PasswordValue` instances; `isPasswordValueType` /
      // `getPasswordString` accept both class instances and the
      // POJO shape so the walker works on either.
      const secrets = collectPasswordSecretsFromCollections({ collections: rootItems })
      const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
      const saved = await saveFile(dataForChecksum)
      if (!saved) return false
      if (filePath) {
        await window.restorm?.secrets.write(`${filePath}.env`, envContent)
      }
    } else {
      // Same rationale as the folder branch above — bulk-clear
      // orphan drafts even when there's no whole-file delta.
      await window.restorm?.file.clearDrafts()
    }
    void setContentChecksum(currentChecksum)
    savedBaselineRef.current = currentChecksum
    markAllTabsSaved()
    await hydrateSaveUnitsFromTree(rootItems)
    return true
  }, [saveFile, rootItems, isOpenedAsFolder, folderFormat, currentFolderPath, filePath, markAllTabsSaved, hydrateSaveUnitsFromTree])

  const handleMenuSaveAll = handleMenuSave

  /**
   * Decomposition cache — invalidated only when the inputs the
   * decomposer reads change (`rootItems` identity, `currentFolderPath`,
   * `folderFormat`). Consecutive save-unit invocations reuse the same
   * `Map<runtimeId, DecomposedUnit>` so a Ctrl+S on a large project
   * stays O(1) after the first miss.
   *
   * The invalidation is coarse on purpose: any state change that
   * replaces `rootItems` already triggers a re-render of this hook,
   * and the cached map would be stale regardless of which node was
   * actually touched.
   */
  const decomposeCacheRef = useRef<{
    rootItems: unknown
    basePath: string | null
    format: string
    units: Map<string, DecomposedUnit>
  } | null>(null)

  /**
   * File-mode decomposition: produces the same per-unit map as folder
   * mode, but using a synthetic base path. The `absolutePath` on each
   * `DecomposedUnit` is meaningless here — we only care about
   * `runtimeId`, `kind`, `parentId` and `content` for registry
   * hydration. Used by per-unit Ctrl+S to identify a subtree of units
   * to commit when the whole file has been rewritten.
   */
  const buildFileModeDecomposition = useCallback((): Map<string, DecomposedUnit> => {
    const units = new Map<string, DecomposedUnit>()
    const rootCount = rootItems.length
    rootItems.forEach((root, rootIdx) => {
      const rootPojo = JSON.parse(JSON.stringify(root)) as Record<string, unknown>
      const rootClass: object = root instanceof EnvironmentFolderClass
        ? EnvironmentFolderClass
        : root instanceof FolderClass
          ? FolderClass
          : EnvironmentFolderClass
      // In file mode `absolutePath` is meaningless but we still wrap
      // each root in its own pseudo-folder so child `parentId` chains
      // and `runtimeId → unit` lookups are consistent across roots.
      const rootBasePath = joinFolderPath(filePath ?? '', rootFolderName(rootPojo, rootIdx, rootCount))
      const decomposed = decomposeForPersistence({
        root: rootPojo,
        rootClass,
        basePath: rootBasePath,
        format: folderFormat,
        extension: folderFormat,
        classResolver: restormClassResolver,
        indexPaddingMin: 1
      })
      units.set(decomposed.rootIndex.runtimeId, decomposed.rootIndex)
      for (const child of decomposed.children) units.set(child.runtimeId, child)
    })
    return units
  }, [rootItems, filePath, folderFormat, rootFolderName, joinFolderPath])

  const getOrBuildUnitMap = useCallback((): Map<string, DecomposedUnit> => {
    const cache = decomposeCacheRef.current
    if (
      cache !== null
      && cache.rootItems === rootItems
      && cache.basePath === currentFolderPath
      && cache.format === folderFormat
    ) {
      return cache.units
    }
    const units = new Map<string, DecomposedUnit>()
    if (currentFolderPath) {
      const rootCount = rootItems.length
      rootItems.forEach((root, rootIdx) => {
        const rootPojo = JSON.parse(JSON.stringify(root)) as Record<string, unknown>
        const rootClass: object = root instanceof EnvironmentFolderClass
          ? EnvironmentFolderClass
          : root instanceof FolderClass
            ? FolderClass
            : EnvironmentFolderClass
        // Wrap each root in its own `{idx} - {name}` folder to match
        // `saveFolderStructure` (main-process save-all). The earlier
        // version passed `currentFolderPath` directly which meant
        // `decomposeForPersistence` treated each root's *children* as
        // immediate descendants of the workspace root — typing + Ctrl+S
        // on a nested request produced an orphan sibling folder at the
        // workspace root (e.g. `04 - accounts/` alongside
        // `1 - Microsoft.Dynamics.CRM/` instead of inside it).
        const rootBasePath = joinFolderPath(currentFolderPath, rootFolderName(rootPojo, rootIdx, rootCount))
        const decomposed = decomposeForPersistence({
          root: rootPojo,
          rootClass,
          basePath: rootBasePath,
          format: folderFormat,
          extension: folderFormat,
          classResolver: restormClassResolver,
          indexPaddingMin: 1
        })
        units.set(decomposed.rootIndex.runtimeId, decomposed.rootIndex)
        for (const child of decomposed.children) units.set(child.runtimeId, child)
      })
    }
    decomposeCacheRef.current = { rootItems, basePath: currentFolderPath, format: folderFormat, units }
    return units
  }, [rootItems, currentFolderPath, folderFormat, rootFolderName, joinFolderPath])

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
   *     even though each env is a separate `@separateFolders` file,
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
    logger.info('[useFileManagement] handleMenuSaveUnit', {
      runtimeId,
      isOpenedAsFolder,
      currentFolderPath
    })
    if (rootItems.length === 0) return false

    const map = getOrBuildUnitMap()
    const target = map.get(runtimeId)
    if (isOpenedAsFolder && currentFolderPath && !target) {
      // Folder mode but we couldn't locate the unit — fall back to save-all.
      return await handleMenuSave()
    }

    const subtreeIds = collectSaveSubtreeIds(runtimeId)

    if (!isOpenedAsFolder || !currentFolderPath) {
      // File mode: write the whole file, then re-hydrate only the subtree
      // so other dirty units stay dirty.
      const fileUnits = buildFileModeDecomposition()
      const fileSubtreeIds = subtreeIds

      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as Record<string, unknown>
      const dataForChecksum = prepareForSerialization(plainData)
      const currentChecksum = JSON.stringify(dataForChecksum)
      const hasRealChanges = await hasContentChanged(currentChecksum)
      // No real disk delta → still commit the subtree's drafts so the
      // per-tab dirty dots clear. The user pressed Ctrl+S on this tab;
      // their expectation is "this tab is now saved".
      const saved = hasRealChanges ? await saveFile(dataForChecksum) : true
      if (!saved) return false
      if (hasRealChanges && filePath) {
        const secrets = collectPasswordSecretsFromCollections({ collections: rootItems })
        const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
        await window.restorm?.secrets.write(`${filePath}.env`, envContent)
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
    }

    // Folder mode: persist only the subtree files.
    const batch = Array.from(subtreeIds)
      .map((id) => map.get(id))
      .filter((unit): unit is DecomposedUnit => unit !== undefined)

    let allOk = true
    for (const entry of batch) {
      const ok = await saveUnitToDisk({
        runtimeId: entry.runtimeId,
        content: entry.content,
        absolutePath: entry.absolutePath,
        format: entry.format
      })
      if (!ok) {
        allOk = false
        continue
      }
      // Re-hydrate the saved unit so any lingering draft (the bridge may
      // have upserted a slightly-different shape than the decomposer's
      // cleanse) gets wiped. The user intent on Ctrl+S is "this unit
      // is now clean", not "maybe clean depending on diff heuristics".
      await hydrateSaveUnit({
        runtimeId: entry.runtimeId,
        kind: entry.kind,
        reference: entry.content,
        ...(entry.parentId !== undefined && { parentId: entry.parentId })
      })
    }
    return allOk
  }, [isOpenedAsFolder, currentFolderPath, rootItems, getOrBuildUnitMap, handleMenuSave, saveFile, filePath, buildFileModeDecomposition, collectSaveSubtreeIds])

  const handleMenuSaveAs = useCallback(() => {
    setSaveOptionsIntent('saveAs')
    setShowSaveOptionsModal(true)
  }, [])

  const handleSaveWithOptions = useCallback(
    async (saveOptions: SaveOptions) => {
      const isNew = saveOptionsIntent === 'new'
      const plainData = isNew
        ? ({ collections: [] } as Record<string, unknown>)
        : (JSON.parse(JSON.stringify({ collections: rootItems })) as Record<string, unknown>)

      logger.info('[useFileManagement] Saving with options', {
        intent: saveOptionsIntent,
        mode: saveOptions.mode,
        format: saveOptions.format
      })

      try {
        if (saveOptions.mode === 'folder') {
          const result = await window.restorm?.file.saveAsFolder(plainData, saveOptions.format)
          if (result?.success && result.path) {
            logger.info('[useFileManagement] Folder saved successfully', { path: result.path })
            if (isNew) {
              setRootItems([])
              clearTabDirtyState()
            }
            setIsOpenedAsFolder(true)
            setFolderFormat(saveOptions.format)
            setCurrentFolderPath(result.path)
            // Close + re-open via `openPath` so the main process properly
            // transitions FileService into folder-mode-opened state
            // (sets `currentFile`, fires `file:opened`, attaches the draft
            // store). Without this the app stays at the welcome screen
            // after a `File → New → Folder mode` and the sidebar never
            // renders the freshly-saved (empty) collection.
            if (isNew) {
              await closeFile()
              await window.restorm?.file.openPath(result.path)
            }
          } else {
            logger.error('[useFileManagement] Failed to save folder', {
              error: result?.error ?? 'Unknown error'
            })
          }
        } else {
          const dataForSave = prepareForSerialization(plainData)
          const result = await window.restorm?.file.saveAsFile(dataForSave, saveOptions.format)
          if (result?.success) {
            logger.info('[useFileManagement] File saved successfully', { path: result.path })
            setIsOpenedAsFolder(false)
            if (result.path) {
              const secrets = collectPasswordSecretsFromCollections({ collections: rootItems })
              const envContent = Object.keys(secrets).length > 0 ? serializeEnvFile(secrets) : ''
              await window.restorm?.secrets.write(`${result.path}.env`, envContent)
            }
            if (isNew && result.path) {
              await closeFile()
              await openFile(result.path)
            }
          } else {
            logger.error('[useFileManagement] Failed to save file', {
              error: result?.error ?? 'Unknown error'
            })
          }
        }
      } catch (error) {
        logger.error('[useFileManagement] Save error', { error: String(error) })
      }
    },
    [rootItems, saveOptionsIntent, setRootItems, clearTabDirtyState, closeFile, openFile]
  )

  const checkUnsavedChanges = useCallback(async (): Promise<boolean> => {
    const dataForChecksum = prepareForSerialization({ collections: rootItems })
    const currentChecksum = JSON.stringify(dataForChecksum)
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
      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as unknown
      const dataForSave = prepareForSerialization(plainData)
      const saved = await saveFile(dataForSave)
      if (saved && filePath) {
        const secrets = collectPasswordSecretsFromCollections({ collections: rootItems })
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
  }, [showUnsavedChangesDialog, rootItems, saveFile, t, fileName, filePath])

  const handleMenuNew = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      setSaveOptionsIntent('new')
      setShowSaveOptionsModal(true)
    }
  }, [checkUnsavedChanges])

  const handleMenuOpen = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      setIsOpenedAsFolder(false)
      await openFile()
    }
  }, [checkUnsavedChanges, openFile])

  const handleMenuOpenFolder = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      const result = await window.restorm?.file.openFolder()
      if (result?.success && result.path) {
        setIsOpenedAsFolder(true)
        setFolderFormat(result.format ?? 'yaml')
        setCurrentFolderPath(result.path)
      }
    }
  }, [checkUnsavedChanges])

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
        setIsOpenedAsFolder(false)
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
        const openedAsFolder = path !== '' && !/\.(json|yaml|yml|json5|restorm)$/i.test(path)
        setIsOpenedAsFolder(openedAsFolder)
        if (openedAsFolder) {
          const format = state.currentFile.format as PersistenceFormat | undefined
          setFolderFormat(format ?? 'yaml')
          setCurrentFolderPath(path)
        } else {
          setCurrentFolderPath(null)
        }

        const content = state.currentFile.content as Record<string, unknown> | null
        if (content && !openedAsFolder && path) {
          const envText = await window.restorm?.secrets.read(`${path}.env`)
          if (envText) {
            const parsed = parseEnvFileDetailed(envText)
            if (parsed.duplicates.length > 0) {
              logger.warn('[useFileManagement] Duplicate keys found in .restorm.env (last wins)', {
                duplicates: parsed.duplicates
              })
            }
            applyPasswordSecretsToCollections(content, parsed.vars)
          }
        }

        const collectionsRaw = (content as { collections?: unknown } | null)?.collections
        const collections = Array.isArray(collectionsRaw) ? (collectionsRaw as EnvironmentFolder[]) : []

        clearTabDirtyState()

        const collectionsWithIds = processAfterDeserialization(collections)
        // Default `fileFormatVersion` to the current value on legacy
        // files (those predating the version field) BEFORE the
        // reactive wrap so the mutation doesn't fire a FOLDER_UPDATED
        // event, and BEFORE the content-checksum baseline (set below)
        // so "default-on-load" doesn't look like a user edit on the
        // next save.
        for (const root of collectionsWithIds) {
          normalizeFileFormatVersion(root, logger)
        }
        // Requests can legally live at the root (see `useImport`'s
        // empty-file branch). Folders and env-folders go through
        // `makeReactiveFolder`; root-level requests go through
        // `makeReactiveRequest` with no parent id so edits still emit
        // `REQUEST_UPDATED` into the dirty tracker / search index.
        const reactiveItems = collectionsWithIds.map((item) =>
          'items' in item ? makeReactiveFolder(item) : makeReactiveRequest(item)
        )
        setRootItems(reactiveItems)

        // Save-unit hydration is deferred to the end of this hook so
        // env-context registration (`clearAll` → `ENVIRONMENT_CREATED`
        // → request register) gets the IPC channel first. Without
        // that, the URL resolver can race the bridge and serve a tab
        // before its env's variables have been published.

        if (openedAsFolder) {
          const registerAllItems = (items: FolderItem[]): void => {
            for (const item of items) {
              const itemChecksum = computeChecksum(JSON.parse(JSON.stringify(item)))
              registerTabDirtyState(item.id, itemChecksum)

              if (isAnyFolder(item)) {
                registerAllItems((item as Folder).items)
              }
            }
          }

          for (const rootItem of reactiveItems) {
            const rootChecksum = computeChecksum(JSON.parse(JSON.stringify(rootItem)))
            registerTabDirtyState(rootItem.id, rootChecksum)
            // Requests at root are leaves with no children to register.
            if ('items' in rootItem) {
              registerAllItems(rootItem.items)
            }
          }
        }

        // Whole-file checksum baseline — still used by `hasContentChanged`
        // to skip redundant saves when nothing has been touched. Per-object
        // dirty state lives in the save-unit registry now, so we no longer
        // feed a parallel checksum map.
        const dataForChecksum = prepareForSerialization({ collections: reactiveItems })
        const baselineChecksum = JSON.stringify(dataForChecksum)
        void setContentChecksum(baselineChecksum)
        savedBaselineRef.current = baselineChecksum

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
            // `PasswordValue.toJSON()` strips the plaintext, so without
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
          // `indexFolderTree` walks folders recursively; requests at
          // the root need their own indexing path (no parent folder
          // to hand off to).
          if ('items' in rootItem) {
            await searchIndexService.indexFolderTree(rootItem)
          } else {
            await searchIndexService.indexRootRequest(rootItem)
          }
        }

        // Hydrate the save-unit registry now that the env-context
        // pipeline has finished publishing its data. The `path` here
        // is the freshly-known one — the closure's
        // `currentFolderPath` / `filePath` still hold their previous
        // render's values until React re-renders.
        if (path) {
          const fmt = (state.currentFile.format as PersistenceFormat | undefined) ?? folderFormat
          await hydrateSaveUnitsFromTree(reactiveItems, { basePath: path, format: fmt })
        }

        await finishLoading()

        isLoadingRef.current = false
      })()
    },
    [clearTabDirtyState, registerTabDirtyState, setRootItems, hydrateSaveUnitsFromTree, folderFormat]
  )

  // Handle file closed event
  const handleFileClosed = useCallback(() => {
    isLoadingRef.current = false
    lastLoadedPathRef.current = null
    setIsOpenedAsFolder(false)
    setCurrentFolderPath(null)
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
        const dataForChecksum = prepareForSerialization({ collections: rootItems })
        const currentChecksum = JSON.stringify(dataForChecksum)
        if (currentChecksum !== baseline) return
        await window.restorm?.file.clearDrafts()
      })()
    }, 200)
    return () => { clearTimeout(timer) }
  }, [rootItems, isDirty])

  // Save-and-close handler
  useEffect(() => {
    const handleSaveAndClose = async (): Promise<void> => {
      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as unknown
      const dataForSave = prepareForSerialization(plainData)
      const saved = await saveFile(dataForSave)
      if (saved) {
        if (filePath) {
          const secrets = collectPasswordSecretsFromCollections({ collections: rootItems })
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
  }, [rootItems, saveFile, filePath])

  return {
    handleMenuNew,
    handleMenuOpen,
    handleMenuOpenFolder,
    handleMenuSave,
    handleMenuSaveAll,
    handleMenuSaveUnit,
    handleMenuSaveAs,
    handleMenuClose,
    handleOpenRecentFile,
    handleSaveWithOptions,
    handleFileOpened,
    handleFileClosed,
    isOpenedAsFolder,
    setIsOpenedAsFolder,
    folderFormat,
    setFolderFormat,
    currentFolderPath,
    setCurrentFolderPath,
    showSaveOptionsModal,
    setShowSaveOptionsModal
  }
}
