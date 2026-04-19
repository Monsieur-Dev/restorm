import { app } from 'electron'
import {
  logger,
  getPersistenceService,
  getFileService,
  isFileServiceInitialized,
  ensureFolderUuid,
  ensureFileUuid,
  serialize as coreSerialize,
  deserialize as coreDeserialize
} from 'electron-core-ui'
import { PROJECT_UUID_KEY } from '../shared/config/projectUuid'
import { join, basename } from 'path'
import { promises as fs, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import type { PersistenceFormat } from 'electron-core-ui'
import { folderMappingService } from './services/FolderMappingService'
import { saveFolderSecretsEnvFile, applyFolderSecretsEnvFile } from './services/SecretsEnvFileService'
import { normalizeDocumentValuesForPersistence } from '../shared/utils/valuePersistence'
import { assertPathWithinParent } from './utils/pathSecurity'

// ==========================================================================
// Configuration
// ==========================================================================

/** Configuration file name for folder-mode projects */
const RESTORM_CONF_FILE = 'restorm.conf'

/** Configuration stored in restorm.conf */
interface RestormConfig {
  format: PersistenceFormat
}

/**
 * Read restorm.conf from a folder, returns default config if not found
 * The config file is stored as YAML for readability
 */
function readRestormConfig(folderPath: string): RestormConfig {
  const confPath = join(folderPath, RESTORM_CONF_FILE)
  if (existsSync(confPath)) {
    try {
      const content = readFileSync(confPath, 'utf-8')
      // Simple YAML parsing for format: value
      const match = /^format:\s*(\w+)/m.exec(content)
      if (match?.[1]) {
        const format = match[1] as PersistenceFormat
        if (['json', 'yaml', 'json5'].includes(format)) {
          return { format }
        }
      }
    } catch (error) {
      logger.warn('Failed to read restorm.conf, using defaults', { error: String(error) })
    }
  }
  // Default to yaml
  return { format: 'yaml' }
}

/**
 * Write restorm.conf to a folder
 * The config file is stored as simple YAML for readability
 */
function writeRestormConfig(folderPath: string, config: RestormConfig): void {
  const confPath = join(folderPath, RESTORM_CONF_FILE)
  const content = `format: ${config.format}\n`
  writeFileSync(confPath, content, 'utf-8')
}

// ==========================================================================
// Naming / Indexing Helpers
// ==========================================================================

/**
 * Calculate the padding width needed for numbering items
 * @param count Total number of items
 * @returns Number of digits needed (e.g., 9→1, 99→2, 999→3)
 */
function getPaddingWidth(count: number): number {
  if (count <= 0) return 1
  return String(count).length
}

/**
 * Format an index number with dynamic padding based on total count
 * @param index 0-based index
 * @param count Total number of items
 * @returns Formatted string (e.g., "1", "01", "001")
 */
function formatIndex(index: number, count: number): string {
  const width = getPaddingWidth(count)
  return String(index + 1).padStart(width, '0')
}

/**
 * Sanitize a name for use as a file/folder name
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim()
    .slice(0, 100)                 // Limit length
}

// ==========================================================================
// ID Generation & Mapping
// ==========================================================================

/**
 * Generate runtime IDs for all objects in the data structure.
 * Called after loading to assign IDs that will be used for tracking.
 *
 * @param data - The loaded data structure
 * @param idProperty - Property name to use for IDs (default: 'id')
 */
function generateRuntimeIds(data: unknown, idProperty = 'id'): void {
  if (!data || typeof data !== 'object') return

  const obj = data as Record<string, unknown>

  // Assign ID if not already present
  obj[idProperty] ??= randomUUID()

  // Recurse into collections
  if (obj['collections'] && Array.isArray(obj['collections'])) {
    for (const collection of obj['collections']) {
      generateRuntimeIds(collection, idProperty)
    }
  }

  // Recurse into items (folders and requests)
  if (obj['items'] && Array.isArray(obj['items'])) {
    for (const item of obj['items']) {
      generateRuntimeIds(item, idProperty)
    }
  }

  // Recurse into environments
  if (obj['environments'] && Array.isArray(obj['environments'])) {
    for (const env of obj['environments']) {
      generateRuntimeIds(env, idProperty)
    }
  }

  // Recurse into sub-environments
  if (obj['subEnvironments'] && Array.isArray(obj['subEnvironments'])) {
    for (const subEnv of obj['subEnvironments']) {
      generateRuntimeIds(subEnv, idProperty)
    }
  }
}

/**
 * Build mapping from loaded data structure with actual file paths.
 * Called during folder loading to associate IDs with their paths.
 */
function buildMappingFromStructure(
  basePath: string,
  data: unknown,
  currentPath: string,
  idProperty = 'id'
): void {
  if (!data || typeof data !== 'object') return

  const obj = data as Record<string, unknown>
  const id = obj[idProperty]

  // Register this object's path
  if (typeof id === 'string' && id) {
    folderMappingService.registerPath(id, currentPath)
  }

  // Recurse into collections (they are subfolders)
  if (obj['collections'] && Array.isArray(obj['collections'])) {
    const collections = obj['collections'] as Record<string, unknown>[]
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i]
      if (!collection) continue
      const collName = (collection['name'] as string) || `Collection_${i + 1}`
      const collPath = join(currentPath, `${formatIndex(i, collections.length)} - ${sanitizeName(collName)}`)
      buildMappingFromStructure(basePath, collection, collPath, idProperty)
    }
  }

  // Recurse into items
  if (obj['items'] && Array.isArray(obj['items'])) {
    const items = obj['items'] as Record<string, unknown>[]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) continue
      const itemName = (item['name'] as string) || `Item_${i + 1}`
      const isFolder = item['items'] !== undefined

      if (isFolder) {
        const folderPath = join(currentPath, `${formatIndex(i, items.length)} - ${sanitizeName(itemName)}`)
        buildMappingFromStructure(basePath, item, folderPath, idProperty)
      } else {
        // It's a request - file path includes method/type
        const methodVal = item['method']
        const typeVal = item['type']
        const method = (typeof methodVal === 'string' ? methodVal : null)
          ?? (typeof typeVal === 'string' ? typeVal : null)
          ?? 'REQ'
        const ext = 'yaml' // Default, actual ext determined by format
        const filePath = join(currentPath, `${formatIndex(i, items.length)} - ${method} - ${sanitizeName(itemName)}.${ext}`)
        const itemIdVal = item[idProperty]
        if (typeof itemIdVal === 'string') {
          folderMappingService.registerPath(itemIdVal, filePath)
        }
      }
    }
  }

  // Recurse into environments
  if (obj['environments'] && Array.isArray(obj['environments'])) {
    const envs = obj['environments'] as Record<string, unknown>[]
    const envsPath = join(currentPath, 'environments')
    for (let i = 0; i < envs.length; i++) {
      const env = envs[i]
      if (!env) continue
      const envName = (env['name'] as string) || `Environment_${i + 1}`
      const envPath = join(envsPath, `${formatIndex(i, envs.length)} - ${sanitizeName(envName)}.yaml`)
      const envIdVal = env[idProperty]
      if (typeof envIdVal === 'string') {
        folderMappingService.registerPath(envIdVal, envPath)
      }
      // Recurse for sub-environments
      buildMappingFromStructure(basePath, env, envPath, idProperty)
    }
  }
}

// ==========================================================================
// Rename Handling
// ==========================================================================

/**
 * Handle rename if the path has changed for an item.
 * Returns the actual path to use (new path after rename, or new path for new items).
 */
function handleRenameIfNeeded(id: string | undefined, newPath: string, _isDirectory: boolean, basePath?: string): string {
  if (!id) return newPath

  const oldPath = folderMappingService.getPath(id)

  if (oldPath && oldPath !== newPath && existsSync(oldPath)) {
    // Path traversal protection: ensure both old and new paths stay within the save root
    if (basePath) {
      try {
        assertPathWithinParent(basePath, oldPath)
        assertPathWithinParent(basePath, newPath)
      } catch {
        logger.warn('Blocked rename - path traversal detected', { oldPath, newPath, basePath })
        return newPath
      }
    }

    try {
      // Ensure parent directory exists
      const parentDir = join(newPath, '..')
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true })
      }

      renameSync(oldPath, newPath)
      logger.debug('Renamed item', { from: oldPath, to: newPath })
    } catch (error) {
      logger.warn('Failed to rename, will create new', { oldPath, newPath, error: String(error) })
    }
  }

  return newPath
}

// ==========================================================================
// Serialization Helpers
// ==========================================================================

/**
 * Recursively strip 'id' properties from key-value objects only.
 * Document ids (folders, environments, requests) are persisted now; only
 * the per-row KeyValue ids are still runtime-only.
 */
function stripIds<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => stripIds(item)) as T
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const isKeyValueLike = 'key' in record && 'value' in record && typeof record['key'] === 'string'
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'id' && isKeyValueLike) continue
      result[key] = stripIds(value)
    }
    return result as T
  }
  return obj
}

/**
 * Save a single file with the given format, stripping IDs before serialization
 */
async function saveFile(
  filePath: string,
  data: Record<string, unknown>,
  format: PersistenceFormat
): Promise<void> {
  const persistenceService = getPersistenceService()
  const cleanData = stripIds(data)
  await persistenceService.saveSingleFile(filePath, cleanData, { format })
}

// ==========================================================================
// Save Functions
// ==========================================================================

/**
 * Save a collection as folder structure with separate files for each item
 */
export async function saveFolderStructure(
  folderPath: string,
  data: Record<string, unknown>,
  format: PersistenceFormat
): Promise<{ success: boolean; path?: string; error?: string }> {
  const ext = format === 'json5' ? 'json5' : format

  try {
    normalizeDocumentValuesForPersistence(data)
    // Start save session to track what's being saved
    folderMappingService.startSaveSession()

    // UUID invariant for folder mode: `ensureFolderUuid` (called from
    // `loadFolderStructure` and `attachDraftStoreForFolder` at open
    // time) stamps `_projectUuid` into `folderPath/index.<ext>`. This
    // function never rewrites that root index on the `collections` path
    // below, so the stamp survives save cycles transparently. If a future
    // refactor adds a root-index write, re-stamp `data[PROJECT_UUID_KEY]`
    // before serializing or the UUID will vanish and every consumer
    // keyed by it (sidebar expansion, env selections, …) will reset.

    // Ensure folder exists
    if (!existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true })
    }

    // Write restorm.conf with the format
    writeRestormConfig(folderPath, { format })

    const collections = data['collections'] as unknown[] | undefined
    if (!collections || !Array.isArray(collections)) {
      // No collections, save as single index file
      const persistenceService = getPersistenceService()
      folderMappingService.commitSaveSession()
      return await persistenceService.saveSingleFile(
        join(folderPath, `index.${ext}`),
        data,
        { format }
      )
    }

    // Save each collection (EnvironmentFolder) as a subfolder
    const collectionCount = collections.length
    for (let collIdx = 0; collIdx < collectionCount; collIdx++) {
      const collection = collections[collIdx] as Record<string, unknown>
      const collectionId = collection['id'] as string | undefined
      const collectionName = (collection['name'] as string) || `Collection_${collIdx + 1}`
      const safeName = sanitizeName(collectionName)
      const newCollectionPath = join(folderPath, `${formatIndex(collIdx, collectionCount)} - ${safeName}`)

      // Handle rename if path changed
      const collectionPath = handleRenameIfNeeded(collectionId, newCollectionPath, true, folderPath)

      if (!existsSync(collectionPath)) {
        mkdirSync(collectionPath, { recursive: true })
      }

      // Mark as seen
      if (collectionId) {
        folderMappingService.markAsSeen(collectionId, collectionPath)
      }

      // Save collection index (without items and environments)
      const { items: collItems, environments, ...collectionIndex } = collection
      await saveFile(join(collectionPath, `index.${ext}`), collectionIndex, format)

      // Save environments in environments/ subfolder
      if (environments && Array.isArray(environments)) {
        const envsPath = join(collectionPath, 'environments')
        if (!existsSync(envsPath)) {
          mkdirSync(envsPath, { recursive: true })
        }
        const envCount = environments.length
        for (let envIdx = 0; envIdx < envCount; envIdx++) {
          const env = environments[envIdx] as Record<string, unknown>
          const envId = env['id'] as string | undefined
          const envName = (env['name'] as string) || `Environment_${envIdx + 1}`
          const safeEnvName = sanitizeName(envName)
          const newEnvPath = join(envsPath, `${formatIndex(envIdx, envCount)} - ${safeEnvName}.${ext}`)

          // Handle rename if path changed
          const envPath = handleRenameIfNeeded(envId, newEnvPath, false, folderPath)

          await saveFile(envPath, env, format)

          // Mark as seen
          if (envId) {
            folderMappingService.markAsSeen(envId, envPath)
          }
        }
      }

      // Save items (folders and requests)
      if (collItems && Array.isArray(collItems)) {
        await saveFolderItems(collectionPath, collItems as Record<string, unknown>[], format, ext, folderPath)
      }
    }

    // Delete orphaned files/folders (items that were removed)
    const orphanedPaths = folderMappingService.getOrphanedPaths()
    for (const orphanPath of orphanedPaths) {
      try {
        if (existsSync(orphanPath)) {
          rmSync(orphanPath, { recursive: true, force: true })
          logger.info('Deleted orphaned path', { path: orphanPath })
        }
      } catch (error) {
        logger.warn('Failed to delete orphaned path', { path: orphanPath, error: String(error) })
      }
    }

    // Commit the save session
    folderMappingService.commitSaveSession()

    // Save PasswordValue secrets to restorm.env at the root of the folder
    try {
      await saveFolderSecretsEnvFile(folderPath, data)
    } catch (error) {
      logger.warn('Failed to save restorm.env secrets file', { error: String(error) })
    }

    return { success: true, path: folderPath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * Recursively save folder items
 */
export async function saveFolderItems(
  parentPath: string,
  items: Record<string, unknown>[],
  format: PersistenceFormat,
  ext: string,
  basePath?: string
): Promise<void> {
  const itemCount = items.length
  for (let idx = 0; idx < itemCount; idx++) {
    const item = items[idx]
    if (!item) continue

    const itemId = item['id'] as string | undefined
    const rawName = item['name']
    const itemName = typeof rawName === 'string' ? rawName : `Item_${idx + 1}`
    const safeName = sanitizeName(itemName)
    const itemType = item['type'] as string | undefined
    const prefix = formatIndex(idx, itemCount)

    if (itemType === 'folder' || item['items'] !== undefined) {
      // It's a folder - create subfolder
      const newFolderPath = join(parentPath, `${prefix} - ${safeName}`)

      // Handle rename if path changed
      const folderPath = handleRenameIfNeeded(itemId, newFolderPath, true, basePath)

      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true })
      }

      // Mark as seen
      if (itemId) {
        folderMappingService.markAsSeen(itemId, folderPath)
      }

      // Save folder index (without items)
      const { items: subItems, ...folderIndex } = item
      await saveFile(join(folderPath, `index.${ext}`), folderIndex, format)

      // Recursively save sub-items
      if (subItems && Array.isArray(subItems)) {
        await saveFolderItems(folderPath, subItems as Record<string, unknown>[], format, ext, basePath)
      }
    } else {
      // It's a request - save as file
      const newFilePath = join(parentPath, `${prefix} - ${safeName}.${ext}`)

      // Handle rename if path changed
      const filePath = handleRenameIfNeeded(itemId, newFilePath, false, basePath)

      await saveFile(filePath, item, format)

      // Mark as seen
      if (itemId) {
        folderMappingService.markAsSeen(itemId, filePath)
      }
    }
  }
}

// ==========================================================================
// Load Functions
// ==========================================================================

/**
 * Load a collection from folder structure
 */
export async function loadFolderStructure(
  folderPath: string
): Promise<{ data: Record<string, unknown>; format: PersistenceFormat } | null> {
  try {
    // Read configuration to get format
    const config = readRestormConfig(folderPath)
    const format = config.format
    const ext = format === 'json5' ? 'json5' : format

    // Stamp / read the stable project UUID FIRST, before we parse anything,
    // so it's available on the content that the renderer sees via the
    // `file:opened` event. This is the identity the renderer uses to key
    // per-project preferences (sidebar expansion, etc) that must survive
    // folder moves and renames — filePath is not stable enough. We pass
    // our own `uuidKey` so existing `_projectUuid`-stamped files keep
    // resolving to the same UUID.
    const { uuid: projectUuid } = await ensureFolderUuid({
      projectPath: folderPath,
      format,
      extension: ext,
      indexFileName: 'index',
      uuidKey: PROJECT_UUID_KEY
    })

    // Look for index file
    const indexFiles = ['index.yaml', 'index.yml', 'index.json', 'index.json5']
    let indexPath: string | null = null

    for (const indexFile of indexFiles) {
      const testPath = join(folderPath, indexFile)
      if (existsSync(testPath)) {
        indexPath = testPath
        break
      }
    }

    let data: Record<string, unknown>

    // If no index file, try to reconstruct from folder structure
    if (!indexPath) {
      data = await reconstructFromFolders(folderPath)
    } else {
      // Load the index file
      const persistenceService = getPersistenceService()
      const result = await persistenceService.loadSingleFile(indexPath)

      if (!result.success || !result.data) {
        return null
      }

      // If it's a collection folder (has subfolders), reconstruct the full structure
      const entries = await fs.readdir(folderPath, { withFileTypes: true })
      const hasSubfolders = entries.some(e => e.isDirectory())

      if (hasSubfolders) {
        data = await reconstructFromFolders(folderPath)
      } else {
        data = result.data as Record<string, unknown>
      }
    }

    // Ensure the top-level project UUID is always present on the data
    // the renderer receives. `reconstructFromFolders` builds a fresh
    // `{ collections }` object that drops root-index metadata, so we
    // re-stamp it here regardless of which branch populated `data`.
    data[PROJECT_UUID_KEY] = projectUuid

    // Apply PasswordValue secrets from restorm.env (if present)
    await applyFolderSecretsEnvFile(folderPath, data)

    // Generate runtime IDs for all objects
    generateRuntimeIds(data, 'id')

    // Build the mapping from IDs to file paths for tracking
    folderMappingService.clear()
    buildMappingFromStructure(folderPath, data, folderPath, 'id')

    logger.info('Folder loaded with ID mapping', {
      path: folderPath,
      mappingSize: folderMappingService.getBasePath() ? 'active' : 'inactive'
    })

    return { data, format }
  } catch (error) {
    logger.error('Failed to load folder structure', { error: String(error) })
    return null
  }
}

/**
 * Reconstruct collection data from folder structure
 */
async function reconstructFromFolders(
  folderPath: string
): Promise<Record<string, unknown>> {
  const collections: Record<string, unknown>[] = []
  const persistenceService = getPersistenceService()

  const entries = await fs.readdir(folderPath, { withFileTypes: true })

  // Sort entries by name (to maintain order from numbered prefixes)
  const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of sortedEntries) {
    if (entry.isDirectory()) {
      const collectionPath = join(folderPath, entry.name)
      const collection = await loadCollectionFolder(collectionPath, persistenceService)
      if (collection) {
        collections.push(collection)
      }
    }
  }

  // If no subfolders found, this might be a single collection root
  if (collections.length === 0) {
    const singleCollection = await loadCollectionFolder(folderPath, persistenceService)
    if (singleCollection) {
      collections.push(singleCollection)
    }
  }

  return { collections }
}

/**
 * Load a single collection folder
 */
async function loadCollectionFolder(
  collectionPath: string,
  persistenceService: ReturnType<typeof getPersistenceService>
): Promise<Record<string, unknown> | null> {
  try {
    // Try to load index file
    let collection: Record<string, unknown> = {}
    const indexFiles = ['index.yaml', 'index.yml', 'index.json', 'index.json5']

    for (const indexFile of indexFiles) {
      const indexPath = join(collectionPath, indexFile)
      if (existsSync(indexPath)) {
        const result = await persistenceService.loadSingleFile(indexPath)
        if (result.success && result.data) {
          collection = result.data as Record<string, unknown>
          break
        }
      }
    }

    // If no index found, create basic collection from folder name
    if (Object.keys(collection).length === 0) {
      const folderName = basename(collectionPath)
      const cleanName = folderName.replace(/^\d+\s*-\s*/, '') // Remove numbering prefix
      collection = { name: cleanName }
    }

    // Load environments from environments/ subfolder
    const envsPath = join(collectionPath, 'environments')
    if (existsSync(envsPath)) {
      const environments: Record<string, unknown>[] = []
      const envEntries = await fs.readdir(envsPath, { withFileTypes: true })
      const sortedEnvEntries = envEntries.sort((a, b) => a.name.localeCompare(b.name))

      for (const envEntry of sortedEnvEntries) {
        if (envEntry.isFile() && /\.(yaml|yml|json|json5)$/.test(envEntry.name)) {
          const envPath = join(envsPath, envEntry.name)
          const result = await persistenceService.loadSingleFile(envPath)
          if (result.success && result.data) {
            environments.push(result.data as Record<string, unknown>)
          }
        }
      }

      if (environments.length > 0) {
        collection['environments'] = environments
      }
    }

    // Load items from other subfolders and files
    const items = await loadFolderItemsRecursive(collectionPath, persistenceService)
    if (items.length > 0) {
      collection['items'] = items
    }

    return collection
  } catch (error) {
    logger.error('Failed to load collection folder', { path: collectionPath, error: String(error) })
    return null
  }
}

/**
 * Recursively load folder items (folders and requests)
 */
async function loadFolderItemsRecursive(
  parentPath: string,
  persistenceService: ReturnType<typeof getPersistenceService>
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []

  const entries = await fs.readdir(parentPath, { withFileTypes: true })
  const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of sortedEntries) {
    // Skip index files and environments folder
    if (entry.name.startsWith('index.') || entry.name === 'environments') {
      continue
    }

    if (entry.isDirectory()) {
      // It's a folder
      const folderPath = join(parentPath, entry.name)
      const folder = await loadSubFolder(folderPath, persistenceService)
      if (folder) {
        items.push(folder)
      }
    } else if (/\.(yaml|yml|json|json5)$/.test(entry.name)) {
      // It's a request file
      const filePath = join(parentPath, entry.name)
      const result = await persistenceService.loadSingleFile(filePath)
      if (result.success && result.data) {
        items.push(result.data as Record<string, unknown>)
      }
    }
  }

  return items
}

/**
 * Load a subfolder (which is a Folder item)
 */
async function loadSubFolder(
  folderPath: string,
  persistenceService: ReturnType<typeof getPersistenceService>
): Promise<Record<string, unknown> | null> {
  try {
    let folder: Record<string, unknown> = {}

    // Try to load index file
    const indexFiles = ['index.yaml', 'index.yml', 'index.json', 'index.json5']
    for (const indexFile of indexFiles) {
      const indexPath = join(folderPath, indexFile)
      if (existsSync(indexPath)) {
        const result = await persistenceService.loadSingleFile(indexPath)
        if (result.success && result.data) {
          folder = result.data as Record<string, unknown>
          break
        }
      }
    }

    // If no index found, create basic folder from name
    if (Object.keys(folder).length === 0) {
      const folderName = basename(folderPath)
      const cleanName = folderName.replace(/^\d+\s*-\s*/, '') // Remove numbering prefix
      folder = { name: cleanName, type: 'folder' }
    }

    // Recursively load sub-items
    const subItems = await loadFolderItemsRecursive(folderPath, persistenceService)
    if (subItems.length > 0) {
      folder['items'] = subItems
    }

    return folder
  } catch (error) {
    logger.error('Failed to load subfolder', { path: folderPath, error: String(error) })
    return null
  }
}

// ==========================================================================
// Draft Store Wiring
// ==========================================================================

/** `userData/drafts` — the root every project's draft dir lives under. */
export function getDraftsRootDir(): string {
  return join(app.getPath('userData'), 'drafts')
}

/**
 * Ensure the currently-loaded folder has a project UUID, attach a
 * `DraftStore` to FileService so per-unit writes land in
 * `userData/drafts/<uuid>`, and restore any drafts that survived a
 * crash. Safe to call on every folder open — previous draft store (if
 * any) is detached first.
 */
export async function attachDraftStoreForFolder(
  folderPath: string,
  format: PersistenceFormat
): Promise<void> {
  if (!isFileServiceInitialized()) {
    logger.warn('attachDraftStoreForFolder: FileService not initialized')
    return
  }
  const ext = format === 'json5' ? 'json5' : format
  try {
    const { uuid, generated } = await ensureFolderUuid({
      projectPath: folderPath,
      format,
      extension: ext,
      indexFileName: 'index',
      uuidKey: PROJECT_UUID_KEY
    })
    if (generated) {
      logger.info('Generated project UUID', { path: folderPath, uuid })
    }

    const fileService = getFileService()
    fileService.detachDraftStore()
    const restored = await fileService.attachDraftStore({
      rootDir: getDraftsRootDir(),
      uuid,
      projectPath: folderPath,
      extension: ext,
      serialize: (value) => coreSerialize(value, format),
      deserialize: (raw) => coreDeserialize(raw, format)
    })
    if (restored > 0) {
      logger.info('Drafts restored for folder', { path: folderPath, count: restored })
    }
  } catch (error) {
    logger.error('Failed to attach draft store', { path: folderPath, error: String(error) })
  }
}

/**
 * File-mode equivalent of `attachDraftStoreForFolder`. Stamps a stable
 * `_projectUuid` into the single-file project and attaches a DraftStore
 * so per-unit drafts survive a crash in file mode too — the recovery
 * UX must match folder mode; only the on-disk layout of the user's
 * saved content differs.
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
    const { uuid, generated } = await ensureFileUuid({ filePath, format, uuidKey: PROJECT_UUID_KEY })
    if (generated) {
      logger.info('Generated project UUID for file', { path: filePath, uuid })
    }

    const fileService = getFileService()
    fileService.detachDraftStore()
    const restored = await fileService.attachDraftStore({
      rootDir: getDraftsRootDir(),
      uuid,
      projectPath: filePath,
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
