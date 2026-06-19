import { app } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { logger } from './LoggerService'
import { PersistenceError, errorMeta } from '../../errors'
import { storageFileSchema } from '../schemas/configSchemas'

/**
 * StorageService provides a simple key-value store backed by a JSON file.
 * The file is stored in the application's user data directory.
 */
export class StorageService {
  private filePath: string
  private data: Record<string, unknown>

  constructor(fileName = 'config.json') {
    const userDataPath = app.getPath('userData')
    this.filePath = join(userDataPath, fileName)
    this.data = this.load()
  }

  /**
   * Load data from the JSON file
   */
  private load(): Record<string, unknown> {
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, 'utf-8')
        const raw: unknown = JSON.parse(content)
        const parsed = storageFileSchema.safeParse(raw)
        if (!parsed.success) {
          logger.warn('Invalid storage file structure, using empty store')
          return {}
        }
        return parsed.data
      }
    } catch (error) {
      const wrappedError = new PersistenceError('Failed to load storage file', 'PERSIST_LOAD_FAILED', { cause: error })
      logger.error('Failed to load storage file', errorMeta(wrappedError))
    }
    return {}
  }

  /**
   * Save data to the JSON file
   */
  private save(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      // Atomic write: serialise to a temp file then rename over the target.
      // A direct writeFileSync that crashes mid-write truncates the file and
      // loses EVERY config key; the temp+rename leaves the old file intact on
      // failure (rename is atomic on the same filesystem).
      const tmpPath = `${this.filePath}.${randomUUID()}.tmp`
      try {
        writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8')
        renameSync(tmpPath, this.filePath)
      } catch (err) {
        try { rmSync(tmpPath, { force: true }) } catch { /* temp already gone */ }
        throw err
      }
    } catch (error) {
      const wrappedError = new PersistenceError('Failed to save storage file', 'PERSIST_SAVE_FAILED', { cause: error })
      logger.error('Failed to save storage file', errorMeta(wrappedError))
    }
  }

  /**
   * Get a value by key
   */
  get(key: string): unknown {
    return this.data[key]
  }

  /**
   * Set a value by key
   */
  set(key: string, value: unknown): void {
    this.data[key] = value
    this.save()
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return key in this.data
  }

  /**
   * Delete a key
   */
  delete(key: string): void {
    if (key in this.data) {
      const { [key]: _removed, ...rest } = this.data
      this.data = rest
      this.save()
    }
  }

  /**
   * Get all data
   */
  getAll(): Record<string, unknown> {
    return { ...this.data }
  }
}

// Singleton instance
let storageInstance: StorageService | null = null

/**
 * Get the singleton instance of StorageService
 */
export function getStorageService(): StorageService {
  storageInstance ??= new StorageService()
  return storageInstance
}
