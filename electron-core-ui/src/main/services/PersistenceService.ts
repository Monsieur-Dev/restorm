/**
 * PersistenceService - Advanced file persistence with folder mode support
 *
 * Features:
 * - JSON, JSON5, and YAML serialization
 * - Single file mode (all data in one file)
 * - Folder mode (data spread across multiple files/folders)
 * - Dynamic file naming with collision avoidance
 * - Support for @separateFiles and @separateFolders decorators
 * - Automatic file renaming on property changes
 */

import { promises as fs } from 'fs'
import { constants as fsConstants, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join, basename, extname, dirname, resolve, relative, isAbsolute } from 'path'
import crypto from 'crypto'
import JSON5 from 'json5'
import yaml from 'js-yaml'
import { logger } from './LoggerService'
import { FileSystemError } from '../../errors'
import {
  getNonSerialisedProperties,
  getSeparateFilesProperties,
  getSeparateFoldersProperties,
  getTreatEmptyAsUndefinedProperties,
  generateFileName,
  type FileNamingConfig
} from '../decorators'

// ============================================================================
// Types
// ============================================================================

/** Supported serialization formats */
export const PERSISTENCE_FORMATS = ['json', 'json5', 'yaml'] as const
export type PersistenceFormat = (typeof PERSISTENCE_FORMATS)[number]

/** Persistence mode */
export type PersistenceMode = 'single-file' | 'folder'

/** Configuration for the persistence service */
export interface PersistenceConfig {
  /** Default file extension (without dot) */
  extension: string
  /** Default serialization format */
  format: PersistenceFormat
  /** Default persistence mode */
  mode: PersistenceMode
  /** Index file name for folder mode */
  indexFileName: string
}

/** File naming context for generating file names */
export interface FileNamingContext {
  /** The document being saved */
  document: Record<string, unknown>
  /** Index of the document in its parent array */
  index: number
  /** Total count of documents in the parent array */
  totalCount: number
  /** Optional class constructor for decorator-based naming */
  classConstructor?: object
}

/** Result of a save operation */
export interface SaveResult {
  success: boolean
  path: string
  error?: string
  /**
   * The failure's machine-readable code — an `fs` errno (`EACCES`,
   * `ENOSPC`, …) or a {@link FileSystemError} code. Stringifying the
   * error for `error` alone would strip it, and the code is what turns a
   * failed save into a cause a user can act on.
   */
  code?: string
}

/** Result of a load operation */
export interface LoadResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ============================================================================
// Serialization Utilities
// ============================================================================

/**
 * Serialize data to string based on format
 */
export function serialize(data: unknown, format: PersistenceFormat): string {
  switch (format) {
    case 'yaml':
      return yaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true })
    case 'json5':
      return JSON5.stringify(data, null, 2)
    case 'json':
    default:
      return JSON.stringify(data, null, 2)
  }
}

/**
 * Deserialize string to data based on format
 */
export function deserialize(content: string, format: PersistenceFormat): unknown {
  switch (format) {
    case 'yaml':
      return yaml.load(content)
    case 'json5':
      return JSON5.parse(content)
    case 'json':
    default:
      return JSON.parse(content) as unknown
  }
}

/**
 * The error's own code, shaped for spreading into a {@link SaveResult}.
 * Empty when the thrown value carries none, so the field stays absent
 * rather than `undefined`.
 */
export function codeOf(error: unknown): { code?: string } {
  const code: unknown = error instanceof Error ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' ? { code } : {}
}

/**
 * Permission mode of an existing target file, or `null` when there is
 * nothing at that path yet (a first write, which the directory's own
 * permissions govern).
 */
async function targetMode(targetPath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(targetPath)
    return stats.isFile() ? stats.mode & 0o7777 : null
  } catch {
    return null
  }
}

/**
 * Refuse to overwrite a file the user has marked read-only.
 *
 * `rename` consults only the DIRECTORY's permissions, so without this the
 * read-only bit offers no resistance whatsoever: the file is replaced and
 * the marking is gone. Honouring it is what most editors do, and it is
 * what turns "the file is read-only" into something the user is told
 * rather than something that silently doesn't happen.
 *
 * This is a DETECTION, not the safety net. `access(W_OK)` is advisory: it
 * lies under ACLs and reports writable for root. So it is deliberately
 * the only thing this function does — every other way a write can fail
 * (unwritable directory, full disk, vanished path, and any case this
 * check waves through) still surfaces from the write's own `catch`, and
 * reaches the user by the same route.
 *
 * Opt-in per call, and deliberately so: a refusal is only useful where a
 * caller can turn it into something the user sees. Applied to every writer
 * it would convert previously-completing work into a mid-operation abort —
 * a multi-file pass has no per-file atomicity to fall back on, and callers
 * that report failure by value rather than by throwing would have their
 * contract broken by an exception they never expected.
 */
async function assertTargetWritable(targetPath: string): Promise<void> {
  try {
    await fs.access(targetPath, fsConstants.W_OK)
  } catch (err: unknown) {
    // Nothing there yet is not a refusal — a first write is governed by
    // the directory, which the write itself will report on.
    if ((err as { code?: unknown }).code === 'ENOENT') return
    throw new FileSystemError(
      `The file is read-only: ${targetPath}`,
      'FS_TARGET_READ_ONLY',
      { cause: err }
    )
  }
}

/**
 * Write a file atomically: serialize to a sibling `<target>.<uuid>.tmp`,
 * then `fs.rename` into place. A mid-write crash leaves the previous
 * target (if any) untouched — callers get a clean "before" state instead
 * of a truncated file. The rename is atomic on the same filesystem, which
 * is always the case when the temp file sits next to the target.
 *
 * Two things `rename` would otherwise get wrong, because it replaces the
 * *inode* rather than the bytes of the existing file — and because it
 * consults only the DIRECTORY's permissions:
 *
 * - **The target's permission mode is carried across**, always. Without it
 *   the file comes back with whatever mode the umask gave the temp file: a
 *   project kept at `600` — they can hold secrets — would silently
 *   return as `644`.
 * - **A read-only target can be refused** ({@link assertTargetWritable}),
 *   instead of being replaced as if it had never been protected — but only
 *   when the caller asks, via `refuseReadOnlyTarget`.
 *
 * That refusal is opt-in because the throw lands on the caller, and only a
 * caller that reports failure to the user can do anything with it. The
 * atomicity here is **per file**: a caller writing several files in one
 * pass would be left mid-operation, with earlier writes done and later
 * ones skipped. Writers that recover by value (`'refused'`, `persisted:
 * false`) or that merely log would turn a refusal into a silent no-op, or
 * into an exception their callers never expected. So the default is the
 * historical behaviour, and the save paths that own a user-facing failure
 * notice switch it on.
 *
 * Everything else that can fail a write — an unwritable directory, a full
 * disk, a vanished path — surfaces as the write's own errno, unchanged,
 * for every caller.
 */
export async function atomicWriteFile(
  targetPath: string,
  contents: string,
  options?: { refuseReadOnlyTarget?: boolean }
): Promise<void> {
  const tmpPath = `${targetPath}.${crypto.randomUUID()}.tmp`
  await fs.mkdir(dirname(targetPath), { recursive: true })
  if (options?.refuseReadOnlyTarget === true) await assertTargetWritable(targetPath)
  const mode = await targetMode(targetPath)
  try {
    await fs.writeFile(tmpPath, contents, 'utf-8')
    if (mode !== null) await fs.chmod(tmpPath, mode)
    await fs.rename(tmpPath, targetPath)
  } catch (err) {
    // Best-effort cleanup of the half-written temp file — ignore its own
    // failures since the original error is what matters.
    try { await fs.unlink(tmpPath) } catch { /* ignore */ }
    throw err
  }
}

/**
 * Detect format from file extension
 */
export function detectFormat(filePath: string): PersistenceFormat {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  if (ext === '.json5') return 'json5'
  return 'json'
}

/**
 * Filter out non-serialized properties based on decorators, and apply
 * `@TreatEmptyAsUndefined` normalization (null / "" / undefined → undefined
 * on marked string props) so empty fields collapse before disk write.
 */
export function filterNonSerialised(
  data: Record<string, unknown>,
  classConstructor?: object
): Record<string, unknown> {
  if (!classConstructor) return data

  const nonSerialised = getNonSerialisedProperties(classConstructor)
  const normalizedStringProps = getTreatEmptyAsUndefinedProperties(classConstructor)

  if (nonSerialised.size === 0 && normalizedStringProps.size === 0) return data

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (nonSerialised.has(key)) continue
    if (normalizedStringProps.has(key) && (value === null || value === '' || value === undefined)) {
      // Marked as "empty → undefined" — drop the key entirely from the
      // serialized form so a never-filled field and a cleared field
      // produce identical files.
      continue
    }
    result[key] = value
  }
  return result
}

// ============================================================================
// File Naming Utilities
// ============================================================================

/**
 * Calculate the number of digits needed for index padding
 */
export function calculateIndexPadding(totalCount: number): number {
  return Math.max(2, String(totalCount).length)
}

/**
 * Safely convert a value to string
 */
function safeToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Generate a file name with dynamic index padding
 */
export function generateIndexedFileName(
  context: FileNamingContext,
  config?: FileNamingConfig
): string {
  const { document, index, totalCount, classConstructor } = context

  // Use decorator-based naming if available
  if (classConstructor) {
    return generateFileName(classConstructor, document, index, totalCount)
  }

  // Use provided config
  if (config) {
    const padding = calculateIndexPadding(totalCount)
    const paddedIndex = String(index + 1).padStart(padding, '0')

    const typeValue = config.typeProperty
      ? safeToString(document[config.typeProperty]).toUpperCase()
      : ''
    const nameValue = config.nameProperty
      ? safeToString(document[config.nameProperty])
      : safeToString(document['name'])

    const fileName = config.pattern
      .replace('{index}', paddedIndex)
      .replace('{type}', typeValue)
      .replace('{name}', nameValue)
      .replace('{id}', safeToString(document['id']))

    // Sanitize file name
    return sanitizeFileName(fileName)
  }

  // Fallback: use name or id
  const docName = safeToString(document['name'])
  const docId = safeToString(document['id'])
  const fallbackName = docName || docId || `item-${index + 1}`
  const padding = calculateIndexPadding(totalCount)
  const paddedIndex = String(index + 1).padStart(padding, '0')
  return sanitizeFileName(`${paddedIndex} - ${fallbackName}`)
}

/**
 * Sanitize a file name by removing invalid characters
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  // `.` / `..` / empty survive the char-class strip above but are path-traversal
  // segments (a folder named `..` would resolve OUTSIDE its parent on join).
  // Map them to a safe placeholder so a sanitized name is always a real child.
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return '_'
  return cleaned
}

/**
 * Parse an indexed file name to extract components
 */
export function parseIndexedFileName(
  fileName: string,
  pattern: string
): { index: number; type: string; name: string } | null {
  // Default pattern: "{index} - {type} - {name}"
  // Convert pattern to regex
  const regexPattern = pattern
    .replace('{index}', '(\\d+)')
    .replace('{type}', '([A-Z]+)')
    .replace('{name}', '(.+)')
    .replace('{id}', '([^.]+)')

  const regex = new RegExp(`^${regexPattern}$`)
  const match = fileName.match(regex)

  if (!match) return null

  return {
    index: parseInt(match[1] ?? '0', 10),
    type: match[2] ?? '',
    name: match[3] ?? ''
  }
}

// ============================================================================
// PersistenceService Class
// ============================================================================

/**
 * PersistenceService handles advanced file persistence
 */
export class PersistenceService {
  private config: PersistenceConfig

  constructor(config?: Partial<PersistenceConfig>) {
    this.config = {
      extension: config?.extension ?? 'json',
      format: config?.format ?? 'json5',
      mode: config?.mode ?? 'single-file',
      indexFileName: config?.indexFileName ?? 'index'
    }
  }

  // ==========================================================================
  // Single File Mode
  // ==========================================================================

  /**
   * Save data to a single file
   */
  async saveSingleFile(
    filePath: string,
    data: Record<string, unknown>,
    options?: {
      format?: PersistenceFormat
      classConstructor?: object
    }
  ): Promise<SaveResult> {
    try {
      const format = options?.format ?? detectFormat(filePath)
      const filteredData = filterNonSerialised(data, options?.classConstructor)
      const content = serialize(filteredData, format)

      await atomicWriteFile(filePath, content)
      logger.debug('[PersistenceService] Saved single file', { path: filePath })
      return { success: true, path: filePath }
    } catch (error) {
      const errorMsg = String(error)
      logger.error('[PersistenceService] Failed to save single file', { path: filePath, error: errorMsg })
      return { success: false, path: filePath, error: errorMsg, ...codeOf(error) }
    }
  }

  /**
   * Load data from a single file
   */
  async loadSingleFile(
    filePath: string,
    options?: { format?: PersistenceFormat }
  ): Promise<LoadResult> {
    try {
      if (!existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }

      const content = await fs.readFile(filePath, 'utf-8')
      const format = options?.format ?? detectFormat(filePath)
      const data = deserialize(content, format)

      logger.debug('[PersistenceService] Loaded single file', { path: filePath })
      return { success: true, data }
    } catch (error) {
      const errorMsg = String(error)
      logger.error('[PersistenceService] Failed to load single file', { path: filePath, error: errorMsg })
      return { success: false, error: errorMsg }
    }
  }

  // ==========================================================================
  // Folder Mode
  // ==========================================================================

  /**
   * Save data to a folder structure
   */
  async saveFolderMode(
    folderPath: string,
    data: Record<string, unknown>,
    options?: {
      format?: PersistenceFormat
      classConstructor?: object
      fileNamingConfig?: FileNamingConfig
      separateFilesProperty?: string
      separateFoldersProperty?: string
    }
  ): Promise<SaveResult> {
    try {
      const format = options?.format ?? this.config.format
      const ext = `.${this.config.extension}`

      // Create folder if it doesn't exist
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true })
      }

      // Determine which properties need separate handling
      const separateFilesProps = options?.classConstructor
        ? getSeparateFilesProperties(options.classConstructor)
        : new Map<string | symbol, unknown>()

      const separateFoldersProps = options?.classConstructor
        ? getSeparateFoldersProperties(options.classConstructor)
        : new Map<string | symbol, unknown>()

      // Also check explicit options
      if (options?.separateFilesProperty) {
        separateFilesProps.set(options.separateFilesProperty, {})
      }
      if (options?.separateFoldersProperty) {
        separateFoldersProps.set(options.separateFoldersProperty, {})
      }

      // Prepare index data (main object without separate properties)
      const indexData: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data)) {
        if (!separateFilesProps.has(key) && !separateFoldersProps.has(key)) {
          indexData[key] = value
        }
      }

      // Filter non-serialized and save index file (atomic temp+rename)
      const filteredIndex = filterNonSerialised(indexData, options?.classConstructor)
      const indexPath = join(folderPath, `${this.config.indexFileName}${ext}`)
      const indexContent = serialize(filteredIndex, format)
      await atomicWriteFile(indexPath, indexContent)

      // Handle @separateFiles properties (array items as individual files)
      for (const [propKey] of separateFilesProps) {
        const propValue = data[propKey as string]
        if (Array.isArray(propValue)) {
          await this.saveArrayAsFiles(
            folderPath,
            propValue,
            propKey as string,
            { format, fileNamingConfig: options?.fileNamingConfig }
          )
        }
      }

      // Handle @separateFolders properties (array items as individual folders)
      for (const [propKey] of separateFoldersProps) {
        const propValue = data[propKey as string]
        if (Array.isArray(propValue)) {
          await this.saveArrayAsFolders(
            folderPath,
            propValue,
            propKey as string,
            { format, fileNamingConfig: options?.fileNamingConfig }
          )
        }
      }

      logger.debug('[PersistenceService] Saved folder', { path: folderPath })
      return { success: true, path: folderPath }
    } catch (error) {
      const errorMsg = String(error)
      logger.error('[PersistenceService] Failed to save folder', { path: folderPath, error: errorMsg })
      return { success: false, path: folderPath, error: errorMsg }
    }
  }

  /**
   * Save array items as individual files in a folder
   */
  private async saveArrayAsFiles(
    folderPath: string,
    items: unknown[],
    _propertyName: string,
    options: { format: PersistenceFormat; fileNamingConfig?: FileNamingConfig | undefined }
  ): Promise<void> {
    const ext = `.${this.config.extension}`
    const totalCount = items.length

    // Track existing files to detect renames/deletions
    const existingFiles = new Set<string>()

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>
      const fileName = generateIndexedFileName(
        { document: item, index: i, totalCount },
        options.fileNamingConfig
      )
      const filePath = join(folderPath, `${fileName}${ext}`)
      existingFiles.add(basename(filePath))

      const content = serialize(item, options.format)
      await atomicWriteFile(filePath, content)
    }

    // Clean up orphaned files (items that were deleted or renamed)
    await this.cleanupOrphanedFiles(folderPath, existingFiles, ext)
  }

  /**
   * Save array items as individual folders
   */
  private async saveArrayAsFolders(
    folderPath: string,
    items: unknown[],
    _propertyName: string,
    options: { format: PersistenceFormat; fileNamingConfig?: FileNamingConfig | undefined }
  ): Promise<void> {
    const totalCount = items.length

    // Track existing folders
    const existingFolders = new Set<string>()

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>
      const folderName = generateIndexedFileName(
        { document: item, index: i, totalCount },
        options.fileNamingConfig
      )
      const itemFolderPath = join(folderPath, folderName)
      existingFolders.add(folderName)

      // Recursively save the item folder
      await this.saveFolderMode(itemFolderPath, item, { format: options.format })
    }

    // Clean up orphaned folders
    this.cleanupOrphanedFolders(folderPath, existingFolders)
  }

  /**
   * Clean up files that no longer correspond to any item
   */
  private async cleanupOrphanedFiles(
    folderPath: string,
    keepFiles: Set<string>,
    extension: string
  ): Promise<void> {
    try {
      const entries = readdirSync(folderPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(extension)) {
          // Skip index file
          if (entry.name.startsWith(this.config.indexFileName)) continue

          if (!keepFiles.has(entry.name)) {
            const filePath = join(folderPath, entry.name)
            await fs.unlink(filePath)
            logger.debug('[PersistenceService] Removed orphaned file', { path: filePath })
          }
        }
      }
    } catch (error) {
      logger.warn('[PersistenceService] Failed to cleanup orphaned files', { error: String(error) })
    }
  }

  /**
   * Clean up folders that no longer correspond to any item
   */
  /** True when `child` resolves to `parent` itself or a path strictly under it. */
  private isPathWithin(parent: string, child: string): boolean {
    const rel = relative(resolve(parent), resolve(child))
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  private cleanupOrphanedFolders(
    parentPath: string,
    keepFolders: Set<string>
  ): void {
    try {
      const entries = readdirSync(parentPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !keepFolders.has(entry.name)) {
          const folderPath = join(parentPath, entry.name)
          // Confine the recursive delete strictly under parentPath — defence in
          // depth against a crafted entry name (`.`/`..`) escaping the parent.
          if (folderPath === resolve(parentPath) || !this.isPathWithin(parentPath, folderPath)) {
            logger.warn('[PersistenceService] Skipped non-confined orphan delete', { parentPath, folderPath })
            continue
          }
          rmSync(folderPath, { recursive: true, force: true })
          logger.debug('[PersistenceService] Removed orphaned folder', { path: folderPath })
        }
      }
    } catch (error) {
      logger.warn('[PersistenceService] Failed to cleanup orphaned folders', { error: String(error) })
    }
  }

  /**
   * Load data from a folder structure
   */
  async loadFolderMode(
    folderPath: string,
    options?: {
      format?: PersistenceFormat
      separateFilesProperties?: string[]
      separateFoldersProperties?: string[]
    }
  ): Promise<LoadResult> {
    try {
      if (!existsSync(folderPath)) {
        return { success: false, error: 'Folder not found' }
      }

      const format = options?.format ?? this.config.format
      const ext = `.${this.config.extension}`

      // Load index file
      const indexPath = join(folderPath, `${this.config.indexFileName}${ext}`)
      const result: Record<string, unknown> = {}

      if (existsSync(indexPath)) {
        const indexContent = await fs.readFile(indexPath, 'utf-8')
        const indexData = deserialize(indexContent, format) as Record<string, unknown>
        Object.assign(result, indexData)
      }

      // Load separate files
      if (options?.separateFilesProperties) {
        for (const prop of options.separateFilesProperties) {
          const items = await this.loadFilesAsArray(folderPath, { format })
          result[prop] = items
        }
      }

      // Load separate folders
      if (options?.separateFoldersProperties) {
        for (const prop of options.separateFoldersProperties) {
          const items = await this.loadFoldersAsArray(folderPath, { format })
          result[prop] = items
        }
      }

      logger.debug('[PersistenceService] Loaded folder', { path: folderPath })
      return { success: true, data: result }
    } catch (error) {
      const errorMsg = String(error)
      logger.error('[PersistenceService] Failed to load folder', { path: folderPath, error: errorMsg })
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Load files from a folder as an array
   */
  private async loadFilesAsArray(
    folderPath: string,
    options: { format: PersistenceFormat }
  ): Promise<unknown[]> {
    const ext = `.${this.config.extension}`
    const items: { index: number; data: unknown }[] = []

    const entries = readdirSync(folderPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(ext)) {
        // Skip index file
        if (entry.name.startsWith(this.config.indexFileName)) continue

        const filePath = join(folderPath, entry.name)
        const content = await fs.readFile(filePath, 'utf-8')
        const data = deserialize(content, options.format)

        // Extract index from file name for sorting
        const nameWithoutExt = entry.name.slice(0, -ext.length)
        const indexMatch = /^(\d+)/.exec(nameWithoutExt)
        const index = indexMatch?.[1] ? parseInt(indexMatch[1], 10) : items.length

        items.push({ index, data })
      }
    }

    // Sort by index and return data
    items.sort((a, b) => a.index - b.index)
    return items.map(item => item.data)
  }

  /**
   * Load folders as an array
   */
  private async loadFoldersAsArray(
    parentPath: string,
    options: { format: PersistenceFormat }
  ): Promise<unknown[]> {
    const items: { index: number; data: unknown }[] = []

    const entries = readdirSync(parentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const folderPath = join(parentPath, entry.name)
        const result = await this.loadFolderMode(folderPath, { format: options.format })

        if (result.success && result.data) {
          // Extract index from folder name for sorting
          const indexMatch = /^(\d+)/.exec(entry.name)
          const index = indexMatch?.[1] ? parseInt(indexMatch[1], 10) : items.length

          items.push({ index, data: result.data })
        }
      }
    }

    // Sort by index and return data
    items.sort((a, b) => a.index - b.index)
    return items.map(item => item.data)
  }

  // ==========================================================================
  // File Synchronization (for folder mode)
  // ==========================================================================

  /**
   * Rename a file when its naming properties change
   */
  async renameFile(
    folderPath: string,
    oldFileName: string,
    newFileName: string
  ): Promise<boolean> {
    try {
      const ext = `.${this.config.extension}`
      const oldPath = join(folderPath, `${oldFileName}${ext}`)
      const newPath = join(folderPath, `${newFileName}${ext}`)

      if (existsSync(oldPath) && oldPath !== newPath) {
        await fs.rename(oldPath, newPath)
        logger.debug('[PersistenceService] Renamed file', { from: oldPath, to: newPath })
        return true
      }
      return false
    } catch (error) {
      logger.error('[PersistenceService] Failed to rename file', { error: String(error) })
      return false
    }
  }

  /**
   * Rename a folder when its naming properties change
   */
  async renameFolder(
    parentPath: string,
    oldFolderName: string,
    newFolderName: string
  ): Promise<boolean> {
    try {
      const oldPath = join(parentPath, oldFolderName)
      const newPath = join(parentPath, newFolderName)

      if (existsSync(oldPath) && oldPath !== newPath) {
        await fs.rename(oldPath, newPath)
        logger.debug('[PersistenceService] Renamed folder', { from: oldPath, to: newPath })
        return true
      }
      return false
    } catch (error) {
      logger.error('[PersistenceService] Failed to rename folder', { error: String(error) })
      return false
    }
  }

  /**
   * Re-index all files in a folder (after reordering).
   *
   * The rename pass is O(N): each existing file is renamed to a
   * unique temp name once, and its `id` is captured during the same
   * read so the subsequent matching lookup is O(1). Previously this
   * method re-parsed every remaining temp on every iteration, making
   * it O(N²) in disk reads for large folders.
   */
  async reindexFiles(
    folderPath: string,
    items: Record<string, unknown>[],
    fileNamingConfig?: FileNamingConfig
  ): Promise<boolean> {
    try {
      const ext = `.${this.config.extension}`
      const format = this.config.format
      const totalCount = items.length

      // Step 1 — move every non-index file to a temp name and capture
      // its `id` in a lookup map. Each temp is read exactly once.
      const tempNameById = new Map<string, string>()
      const unmatchedTemps = new Set<string>()
      const entries = readdirSync(folderPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(ext)) continue
        if (entry.name.startsWith(this.config.indexFileName)) continue

        const tempName = `__temp_${crypto.randomUUID()}${ext}`
        const oldPath = join(folderPath, entry.name)
        const tempPath = join(folderPath, tempName)

        const content = await fs.readFile(oldPath, 'utf-8')
        await fs.rename(oldPath, tempPath)

        let id: string | undefined
        try {
          const parsed = deserialize(content, format) as Record<string, unknown>
          id = safeToString(parsed['id'])
        } catch {
          id = undefined
        }

        if (id !== undefined && id !== '') {
          tempNameById.set(id, tempName)
        } else {
          unmatchedTemps.add(tempName)
        }
      }

      // Step 2 — write each item at its new index, preferring a rename
      // of its matching temp (O(1) lookup) and falling back to a fresh
      // atomic write when no temp matches (new item, or id was missing).
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (!item) continue

        const fileName = generateIndexedFileName(
          { document: item, index: i, totalCount },
          fileNamingConfig
        )
        const filePath = join(folderPath, `${fileName}${ext}`)
        const itemId = safeToString(item['id'])
        const matchingTempName = itemId ? tempNameById.get(itemId) : undefined

        if (matchingTempName) {
          await fs.rename(join(folderPath, matchingTempName), filePath)
          tempNameById.delete(itemId)
        } else {
          await atomicWriteFile(filePath, serialize(item, format))
        }
      }

      // Step 3 — drop orphaned temps (items that were removed, or
      // files that had no recoverable id).
      for (const tempName of tempNameById.values()) unmatchedTemps.add(tempName)
      for (const tempName of unmatchedTemps) {
        const tempPath = join(folderPath, tempName)
        if (existsSync(tempPath)) {
          await fs.unlink(tempPath)
        }
      }

      logger.debug('[PersistenceService] Re-indexed files', { path: folderPath, count: items.length })
      return true
    } catch (error) {
      logger.error('[PersistenceService] Failed to re-index files', { error: String(error) })
      return false
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(folderPath: string, fileName: string): Promise<boolean> {
    try {
      const ext = `.${this.config.extension}`
      const filePath = join(folderPath, `${fileName}${ext}`)

      if (existsSync(filePath)) {
        await fs.unlink(filePath)
        logger.debug('[PersistenceService] Deleted file', { path: filePath })
        return true
      }
      return false
    } catch (error) {
      logger.error('[PersistenceService] Failed to delete file', { error: String(error) })
      return false
    }
  }

  /**
   * Delete a folder
   */
  deleteFolder(folderPath: string): boolean {
    try {
      // Sanity guard for a recursive force-delete: require an absolute path and
      // refuse a filesystem root, so a bad/empty/relative argument can't wipe an
      // unintended tree.
      const resolved = resolve(folderPath)
      if (!isAbsolute(folderPath) || resolved === dirname(resolved)) {
        logger.warn('[PersistenceService] Refused to delete a non-confined path', { folderPath })
        return false
      }
      if (existsSync(resolved)) {
        rmSync(resolved, { recursive: true, force: true })
        logger.debug('[PersistenceService] Deleted folder', { path: resolved })
        return true
      }
      return false
    } catch (error) {
      logger.error('[PersistenceService] Failed to delete folder', { error: String(error) })
      return false
    }
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get current configuration
   */
  getConfig(): PersistenceConfig {
    return { ...this.config }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<PersistenceConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

// Singleton instance
let persistenceServiceInstance: PersistenceService | null = null

/**
 * Initialize the persistence service singleton
 */
export function initPersistenceService(config?: Partial<PersistenceConfig>): PersistenceService {
  if (persistenceServiceInstance) {
    logger.warn('[PersistenceService] Already initialized, returning existing instance')
    return persistenceServiceInstance
  }

  logger.info('[PersistenceService] Creating singleton instance...')
  persistenceServiceInstance = new PersistenceService(config)
  return persistenceServiceInstance
}

/**
 * Get the persistence service singleton
 */
export function getPersistenceService(): PersistenceService {
  if (!persistenceServiceInstance) {
    throw new Error('PersistenceService not initialized. Call initPersistenceService() first.')
  }
  return persistenceServiceInstance
}

/**
 * Check if the service is initialized
 */
export function isPersistenceServiceInitialized(): boolean {
  return persistenceServiceInstance !== null
}
