import { app } from 'electron'
import {
  logger,
  getFileService,
  isFileServiceInitialized,
  ensureFileUuid,
  serialize as coreSerialize,
  deserialize as coreDeserialize
} from 'electron-core-ui'
import { PROJECT_UUID_KEY } from '../shared/config/projectUuid'
import { join } from 'path'
import type { PersistenceFormat } from 'electron-core-ui'
import { collectionStore } from './services/CollectionStore'
import { permissionService } from 'electron-core-ui'
import { collectProjectOrigins } from '../shared/firewall/collectProjectOrigins'
import type { FolderItem } from '../shared/types/collections'

// ==========================================================================
// Draft Store Wiring
// ==========================================================================

/** `userData/drafts` — the root every project's draft dir lives under. */
export function getDraftsRootDir(): string {
  return join(app.getPath('userData'), 'drafts')
}

/**
 * Load a `.restorm` project file into the main-process
 * {@link collectionStore} — the model the scenario engine reads from. Used by
 * the headless CLI runner so a scenario can execute with NO renderer.
 *
 * Deliberately routes through the SAME `FileService.open` the interactive flow
 * uses, so there is no second parser: the difference from the normal flow is
 * only that here MAIN populates `collectionStore` directly instead of the
 * renderer pushing it back via GraphQL. The top-level
 * `FileService.onStateChanged` listener (in `index.ts`) still fires off this
 * open, so the SettingsService workspace path (used by file-IO scenario nodes)
 * is set exactly as usual.
 */
export async function loadProjectIntoStore(targetPath: string): Promise<void> {
  if (!isFileServiceInitialized()) throw new Error('FileService is not initialized')
  const result = await getFileService().open(targetPath)
  if (!result.success || result.content == null) {
    throw new Error(`failed to load project: ${targetPath}`)
  }
  const collections = ((result.content as { collections?: unknown }).collections ?? []) as Parameters<typeof collectionStore.setCollections>[0]
  collectionStore.setCollections(collections, 'file-load')
  // Populate ContextService (per-environment `{{var}}` resolution) the way the
  // renderer's per-document load events would — without a renderer here.
  collectionStore.reemitAllEnvironmentsCreated()
  // Seed the firewall's project-origins the way the renderer's
  // `useFirewallProjectOriginsSync` hook does — so a scenario node calling a
  // project URL (e.g. a `code` node's `pm.sendRequest`, which goes THROUGH the
  // firewall) isn't denied for lack of a prompt in headless.
  permissionService.setProjectOrigins(collectProjectOrigins(collections as unknown as FolderItem[]))
}

/**
 * Stamp a stable `_projectUuid` into the single-file project and attach a
 * DraftStore so per-unit drafts survive a crash.
 *
 * Opens reach this function TWICE for the same open: the reactive
 * `onStateChanged` listener in `index.ts` fires as soon as
 * `FileService.open()` updates `currentFile.path`, and the caller that
 * awaited that same `open()` calls it too. Relies on `attachDraftStore`
 * de-duplicating a repeat call for the same project so the "drafts
 * restored" toast still fires exactly once.
 */
export async function attachDraftStoreForFile(
  filePath: string,
  format: PersistenceFormat
): Promise<void> {
  if (!isFileServiceInitialized()) {
    logger.warn('attachDraftStoreForFile: FileService not initialized')
    return
  }
  // Map the project file's extension to a persistence format string
  // the draft store can use. `.restorm` files are YAML under the hood.
  const ext = format === 'json5' ? 'json5' : format
  try {
    const { uuid, generated, persisted } = await ensureFileUuid({ filePath, format, uuidKey: PROJECT_UUID_KEY })
    if (generated) {
      logger.info('Generated project UUID for file', { path: filePath, uuid })
    }
    if (!persisted) {
      // The identity could not be written without rewriting the user's
      // file, so it is a fresh value on every call. Attaching a draft
      // store to it would be WORSE than not attaching one: the two
      // attaches a single open performs would land on different
      // namespaces, and a crash would file the drafts under an id
      // nothing can find again — unsaved work that looks recoverable
      // and is not. No crash recovery for this project is the honest
      // outcome; the project itself opens and saves normally.
      logger.warn(
        'No crash-recovery drafts for this project: its identity could not be stored without rewriting the file',
        { path: filePath }
      )
      return
    }

    const fileService = getFileService()
    const restored = await fileService.attachDraftStore({
      rootDir: getDraftsRootDir(),
      uuid,
      extension: ext,
      serialize: (value) => coreSerialize(value, format),
      deserialize: (raw) => coreDeserialize(raw, format)
    })
    if (restored > 0) {
      logger.info('Drafts restored for file', { path: filePath, count: restored })
    }
  } catch (error) {
    logger.error('Failed to attach draft store (file mode)', { path: filePath, error: String(error) })
  }
}
