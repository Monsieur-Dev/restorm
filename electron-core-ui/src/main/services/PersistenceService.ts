/**
 * PersistenceService - File persistence
 *
 * Features:
 * - JSON, JSON5, and YAML serialization
 * - Atomic single-file save/load
 */

import { promises as fs } from 'fs'
import { constants as fsConstants, existsSync } from 'fs'
import { extname, dirname } from 'path'
import crypto from 'crypto'
import JSON5 from 'json5'
import yaml from 'js-yaml'
import { logger } from './LoggerService'
import { FileSystemError } from '../../errors'
import {
  getNonSerialisedProperties,
  getTreatEmptyAsUndefinedProperties
} from '../decorators'

// ============================================================================
// Types
// ============================================================================

/** Supported serialization formats */
export const PERSISTENCE_FORMATS = ['json', 'json5', 'yaml'] as const
export type PersistenceFormat = (typeof PERSISTENCE_FORMATS)[number]

/** Configuration for the persistence service */
export interface PersistenceConfig {
  /** Default file extension (without dot) */
  extension: string
  /** Default serialization format */
  format: PersistenceFormat
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
      format: config?.format ?? 'json5'
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
