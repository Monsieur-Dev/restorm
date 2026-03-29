import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { logger } from './LoggerService'
import { PersistenceError, errorMeta } from '../../errors'

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
        return JSON.parse(content) as Record<string, unknown>
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
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
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
