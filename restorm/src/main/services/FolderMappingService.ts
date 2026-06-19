/**
 * Service to track mappings between object IDs and their file/folder paths.
 * Used to detect renames, moves, and deletions during folder-mode saves.
 */

import { logger } from 'electron-core-ui/main'

/**
 * Manages the mapping between runtime IDs and file system paths.
 * This allows proper handling of renames, moves, and deletions when saving.
 */
class FolderMappingService {
  /** Current mapping: id -> absolute path */
  private mapping = new Map<string, string>()
  
  /** Base path of the currently loaded folder */
  private basePath: string | null = null
  
  /** IDs seen during current save session */
  private seenIds = new Set<string>()
  
  /** New mapping being built during save session */
  private newMapping = new Map<string, string>()
  
  /** Whether a save session is in progress */
  private inSaveSession = false

  /**
   * Register a specific ID with its path.
   * Used during folder loading to associate IDs with actual file paths.
   */
  registerPath(id: string, path: string): void {
    this.mapping.set(id, path)
  }

  /**
   * Get the current path for an ID.
   * Returns null if the ID is not tracked (new item).
   */
  getPath(id: string): string | null {
    return this.mapping.get(id) ?? null
  }

  /**
   * Start a save session.
   * Call this before saving to track which items are still present.
   */
  startSaveSession(): void {
    this.inSaveSession = true
    this.seenIds.clear()
    this.newMapping.clear()
    logger.debug('FolderMappingService: Save session started', { 
      currentMappingSize: this.mapping.size
    })
  }

  /**
   * Mark an ID as seen during save and register its new path.
   * 
   * @param id - The object's ID
   * @param newPath - The new path where the object is saved
   */
  markAsSeen(id: string, newPath: string): void {
    if (!this.inSaveSession) {
      logger.warn('FolderMappingService: markAsSeen called outside save session')
      return
    }
    this.seenIds.add(id)
    this.newMapping.set(id, newPath)
  }

  /**
   * Get paths of items that were deleted (IDs not seen during save).
   * These files/folders should be removed from disk.
   */
  getOrphanedPaths(): string[] {
    const orphaned: string[] = []
    
    for (const [id, path] of this.mapping) {
      if (!this.seenIds.has(id)) {
        orphaned.push(path)
      }
    }
    
    // Sort by path length descending so children are deleted before parents
    orphaned.sort((a, b) => b.length - a.length)
    
    logger.info('FolderMappingService: Found orphaned paths', { 
      count: orphaned.length,
      paths: orphaned 
    })
    
    return orphaned
  }

  /**
   * Commit the save session, replacing the old mapping with the new one.
   */
  commitSaveSession(): void {
    if (!this.inSaveSession) {
      logger.warn('FolderMappingService: commitSaveSession called outside save session')
      return
    }
    
    this.mapping = new Map(this.newMapping)
    this.seenIds.clear()
    this.newMapping.clear()
    this.inSaveSession = false
    
    logger.debug('FolderMappingService: Save session committed', {
      entryCount: this.mapping.size
    })
  }

  /**
   * Clear all mappings.
   */
  clear(): void {
    this.mapping.clear()
    this.basePath = null
    this.seenIds.clear()
    this.newMapping.clear()
    this.inSaveSession = false
  }

  /**
   * Get the base path of the current folder.
   */
  getBasePath(): string | null {
    return this.basePath
  }

  /**
   * Check if a save session is in progress.
   */
  isInSaveSession(): boolean {
    return this.inSaveSession
  }
}

// Singleton instance
export const folderMappingService = new FolderMappingService()
