import { dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { basename, extname } from 'path'
import yaml from 'js-yaml'
import type {
  SerializationFormat,
  FileMetadata,
  CurrentFileState,
  FileServiceConfig,
  SaveDialogResult,
  OpenDialogResult,
  FileServiceState
} from '../../../types/file'
import { logger } from './LoggerService'
import { getStorageService } from './StorageService'

/**
 * FileService manages file operations with serialization support
 *
 * Features:
 * - JSON and YAML serialization
 * - Recent files tracking
 * - Favorites management
 * - Dirty flag for unsaved changes
 * - Native file dialogs (desktop)
 */
export class FileService {
  private config: FileServiceConfig
  private currentFile: CurrentFileState
  private recentFiles: FileMetadata[] = []
  private stateChangeCallbacks = new Set<(state: FileServiceState) => void>()
  private dirtyChangeCallbacks = new Set<(isDirty: boolean) => void>()

  private readonly RECENT_FILES_KEY: string
  private readonly FAVORITES_KEY: string

  constructor(config: Partial<FileServiceConfig> = {}) {
    this.config = {
      extension: config.extension ?? '.json',
      defaultFormat: config.defaultFormat ?? 'json',
      maxRecentFiles: config.maxRecentFiles ?? 10,
      storagePrefix: config.storagePrefix ?? 'file_'
    }

    this.RECENT_FILES_KEY = `${this.config.storagePrefix}recent`
    this.FAVORITES_KEY = `${this.config.storagePrefix}favorites`

    this.currentFile = {
      path: null,
      name: null,
      isDirty: false,
      content: null,
      format: this.config.defaultFormat,
      contentChecksum: null
    }

    this.loadPersistedData()
  }

  /**
   * Load persisted recent files and favorites from storage
   */
  private loadPersistedData(): void {
    const storage = getStorageService()

    // Load recent files
    const savedRecent = storage.get(this.RECENT_FILES_KEY) as FileMetadata[] | undefined
    if (savedRecent && Array.isArray(savedRecent)) {
      // Filter out files that no longer exist
      this.recentFiles = savedRecent.filter((file: FileMetadata) => this.fileExists(file.path))
      // Update storage if some files were removed
      if (this.recentFiles.length !== savedRecent.length) {
        this.saveRecentFiles()
      }
    }

    // Load favorites from recent files
    const savedFavorites = storage.get(this.FAVORITES_KEY) as string[] | undefined
    if (savedFavorites && Array.isArray(savedFavorites)) {
      // Update favorite flags in recent files
      for (const file of this.recentFiles) {
        file.isFavorite = savedFavorites.includes(file.path)
      }
    }

    logger.info('FileService: Loaded persisted data', {
      recentCount: this.recentFiles.length,
      favoriteCount: this.getFavorites().length
    })
  }

  /**
   * Check if a file exists (desktop only)
   */
  private fileExists(path: string): boolean {
    try {
      return existsSync(path)
    } catch {
      return false
    }
  }

  /**
   * Save recent files to storage
   */
  private saveRecentFiles(): void {
    const storage = getStorageService()
    storage.set(this.RECENT_FILES_KEY, this.recentFiles)
  }

  /**
   * Save favorites to storage
   */
  private saveFavorites(): void {
    const storage = getStorageService()
    const favorites = this.recentFiles.filter((f) => f.isFavorite).map((f) => f.path)
    storage.set(this.FAVORITES_KEY, favorites)
  }

  /**
   * Add or update a file in recent files
   */
  private addToRecentFiles(path: string, name: string): void {
    // Remove if already exists
    this.recentFiles = this.recentFiles.filter((f) => f.path !== path)

    // Check if it was a favorite
    const storage = getStorageService()
    const favorites = (storage.get(this.FAVORITES_KEY) ?? []) as string[]
    const isFavorite = favorites.includes(path)

    // Add to beginning
    this.recentFiles.unshift({
      path,
      name,
      lastOpened: Date.now(),
      isFavorite
    })

    // Trim to max size (but keep favorites)
    const nonFavorites = this.recentFiles.filter((f) => !f.isFavorite)
    const favoritesInList = this.recentFiles.filter((f) => f.isFavorite)

    if (nonFavorites.length > this.config.maxRecentFiles) {
      const trimmed = nonFavorites.slice(0, this.config.maxRecentFiles)
      this.recentFiles = [...favoritesInList, ...trimmed].sort(
        (a, b) => b.lastOpened - a.lastOpened
      )
    }

    this.saveRecentFiles()
  }

  /**
   * Serialize content to string
   */
  private serialize(content: unknown, format: SerializationFormat): string {
    switch (format) {
      case 'yaml':
        return yaml.dump(content, { indent: 2, lineWidth: -1 })
      case 'json':
      default:
        return JSON.stringify(content, null, 2)
    }
  }

  /**
   * Deserialize string to content
   */
  private deserialize(data: string, format: SerializationFormat): unknown {
    switch (format) {
      case 'yaml':
        return yaml.load(data)
      case 'json':
      default:
        return JSON.parse(data)
    }
  }

  /**
   * Get file name without path and extension
   */
  private getDisplayName(path: string): string {
    const base = basename(path)
    const ext = extname(base)
    return ext ? base.slice(0, -ext.length) : base
  }

  /**
   * Detect format from file extension
   */
  private detectFormat(path: string): SerializationFormat {
    const ext = extname(path).toLowerCase()
    if (ext === '.yaml' || ext === '.yml') {
      return 'yaml'
    }
    return this.config.defaultFormat
  }

  /**
   * Notify state change listeners (local and via IPC)
   */
  private notifyStateChange(): void {
    const state = this.getState()
    // Notify local callbacks
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(state)
      } catch (error) {
        logger.error('FileService: Error in state change callback', { error: String(error) })
      }
    }
    // Broadcast to all renderer windows via IPC
    this.broadcastEvent('file:state-changed', state)
  }

  /**
   * Notify dirty change listeners (local and via IPC)
   */
  private notifyDirtyChange(): void {
    // Notify local callbacks
    for (const callback of this.dirtyChangeCallbacks) {
      try {
        callback(this.currentFile.isDirty)
      } catch (error) {
        logger.error('FileService: Error in dirty change callback', { error: String(error) })
      }
    }
    // Broadcast to all renderer windows via IPC
    this.broadcastEvent('file:dirty-changed', this.currentFile.isDirty)
  }

  /**
   * Broadcast an event to all windows via IPC
   */
  private broadcastEvent(channel: string, ...args: unknown[]): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args)
      }
    }
  }

  /**
   * Create a new file - shows SaveAs dialog first
   * Returns true if file was created, false if user cancelled
   */
  public async newFile(): Promise<boolean> {
    // Show SaveAs dialog to get the new file path
    const result = await this.showSaveDialog()
    if (result.canceled || !result.filePath) {
      return false
    }

    let filePath = result.filePath
    // Ensure correct extension
    if (!filePath.endsWith(this.config.extension)) {
      filePath += this.config.extension
    }

    const name = this.getDisplayName(filePath)

    // Create empty file
    try {
      const emptyContent = {}
      const data = this.serialize(emptyContent, this.config.defaultFormat)
      writeFileSync(filePath, data, 'utf-8')

      this.currentFile = {
        path: filePath,
        name,
        isDirty: false,
        content: emptyContent,
        format: this.config.defaultFormat,
        contentChecksum: JSON.stringify(emptyContent)
      }

      this.addToRecentFiles(filePath, name)
      this.notifyStateChange()
      this.notifyDirtyChange()
      
      // Broadcast file opened event
      this.broadcastEvent('file:opened', this.getState())
      
      logger.info('FileService: New file created', { path: filePath })
      return true
    } catch (error) {
      logger.error('FileService: Failed to create new file', { error: String(error) })
      return false
    }
  }

  /**
   * Open a file
   */
  public async open(path?: string): Promise<{ success: boolean; content?: unknown }> {
    let filePath: string

    // Show dialog if no path provided
    if (path) {
      filePath = path
    } else {
      const result = await this.showOpenDialog()
      const selectedPath = result.filePaths[0]
      if (result.canceled || !selectedPath) {
        return { success: false }
      }
      filePath = selectedPath
    }

    try {
      const data = readFileSync(filePath, 'utf-8')
      const format = this.detectFormat(filePath)
      const content = this.deserialize(data, format)
      const name = this.getDisplayName(filePath)

      this.currentFile = {
        path: filePath,
        name,
        isDirty: false,
        content,
        format,
        contentChecksum: JSON.stringify(content)
      }

      this.addToRecentFiles(filePath, name)
      this.notifyStateChange()
      this.notifyDirtyChange()
      
      // Broadcast file opened event
      this.broadcastEvent('file:opened', this.getState())

      logger.info('FileService: File opened', { path: filePath, format })
      return { success: true, content }
    } catch (error) {
      logger.error('FileService: Failed to open file', { path: filePath, error: String(error) })
      return { success: false }
    }
  }

  /**
   * Save current file
   */
  public async save(content: unknown): Promise<boolean> {
    // If no current file, use SaveAs
    if (!this.currentFile.path) {
      return this.saveAs(content)
    }

    try {
      const data = this.serialize(content, this.currentFile.format)
      writeFileSync(this.currentFile.path, data, 'utf-8')

      this.currentFile.content = content
      this.currentFile.isDirty = false
      this.currentFile.contentChecksum = JSON.stringify(content)
      this.notifyStateChange()
      this.notifyDirtyChange()

      logger.info('FileService: File saved', { path: this.currentFile.path })
      return true
    } catch (error) {
      logger.error('FileService: Failed to save file', { error: String(error) })
      return false
    }
  }

  /**
   * Save file with a new name/path
   */
  public async saveAs(
    content: unknown,
    filename?: string,
    format?: SerializationFormat
  ): Promise<boolean> {
    let filePath = filename

    // Show dialog if no filename provided
    if (!filePath) {
      const result = await this.showSaveDialog()
      if (result.canceled || !result.filePath) {
        return false
      }
      filePath = result.filePath
    }

    // Ensure correct extension
    if (!filePath.endsWith(this.config.extension)) {
      filePath += this.config.extension
    }

    const fileFormat = format ?? this.detectFormat(filePath)

    try {
      const data = this.serialize(content, fileFormat)
      writeFileSync(filePath, data, 'utf-8')

      const name = this.getDisplayName(filePath)
      this.currentFile = {
        path: filePath,
        name,
        isDirty: false,
        content,
        format: fileFormat,
        contentChecksum: JSON.stringify(content)
      }

      this.addToRecentFiles(filePath, name)
      this.notifyStateChange()
      this.notifyDirtyChange()

      logger.info('FileService: File saved as', { path: filePath, format: fileFormat })
      return true
    } catch (error) {
      logger.error('FileService: Failed to save file', { error: String(error) })
      return false
    }
  }

  /**
   * Close current file
   */
  public close(): boolean {
    this.currentFile = {
      path: null,
      name: null,
      isDirty: false,
      content: null,
      format: this.config.defaultFormat,
      contentChecksum: null
    }
    this.notifyStateChange()
    this.notifyDirtyChange()
    
    // Broadcast file closed event so apps can clean up (e.g., clear workbench)
    this.broadcastEvent('file:closed')
    
    logger.info('FileService: File closed')
    return true
  }

  /**
   * Show native open dialog
   */
  public async showOpenDialog(): Promise<OpenDialogResult> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const dialogOptions = {
      properties: ['openFile' as const],
      filters: [
        { name: 'Files', extensions: [this.config.extension.replace('.', '')] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }

    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    return {
      canceled: result.canceled,
      filePaths: result.filePaths
    }
  }

  /**
   * Show native save dialog
   */
  public async showSaveDialog(defaultName?: string): Promise<SaveDialogResult> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const filters = [
      { name: 'Files', extensions: [this.config.extension.replace('.', '')] },
      { name: 'All Files', extensions: ['*'] }
    ]

    const result = focusedWindow
      ? await dialog.showSaveDialog(focusedWindow, defaultName ? { defaultPath: defaultName, filters } : { filters })
      : await dialog.showSaveDialog(defaultName ? { defaultPath: defaultName, filters } : { filters })

    return {
      canceled: result.canceled,
      filePath: result.filePath
    }
  }

  /**
   * Show unsaved changes confirmation dialog
   * Returns: 'save' | 'discard' | 'cancel'
   * @param labels Optional labels for i18n support
   */
  public async showUnsavedChangesDialog(labels?: {
    title?: string
    message?: string
    detail?: string
    save?: string
    dontSave?: string
    cancel?: string
  }): Promise<'save' | 'discard' | 'cancel'> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const fileName = this.currentFile.name ?? 'Untitled'
    
    const options = {
      type: 'warning' as const,
      buttons: [
        labels?.save ?? 'Save',
        labels?.dontSave ?? "Don't Save",
        labels?.cancel ?? 'Cancel'
      ],
      defaultId: 0,
      cancelId: 2,
      title: labels?.title ?? 'Unsaved Changes',
      message: labels?.message ?? `Do you want to save the changes to "${fileName}"?`,
      detail: labels?.detail ?? 'Your changes will be lost if you don\'t save them.'
    }

    const result = focusedWindow
      ? await dialog.showMessageBox(focusedWindow, options)
      : await dialog.showMessageBox(options)

    switch (result.response) {
      case 0:
        return 'save'
      case 1:
        return 'discard'
      default:
        return 'cancel'
    }
  }

  /**
   * Get current file state
   */
  public getState(): FileServiceState {
    return {
      currentFile: { ...this.currentFile },
      recentFiles: [...this.recentFiles],
      favorites: this.getFavorites(),
      platform: 'desktop'
    }
  }

  /**
   * Get current file name
   */
  public getFileName(): string | null {
    return this.currentFile.name
  }

  /**
   * Get current file path
   */
  public getFilePath(): string | null {
    return this.currentFile.path
  }

  /**
   * Check if file is dirty
   */
  public isDirty(): boolean {
    return this.currentFile.isDirty
  }

  /**
   * Mark file as dirty
   */
  public markDirty(): void {
    if (!this.currentFile.isDirty) {
      this.currentFile.isDirty = true
      this.notifyStateChange()
      this.notifyDirtyChange()
    }
  }

  /**
   * Clear dirty flag
   */
  public clearDirty(): void {
    if (this.currentFile.isDirty) {
      this.currentFile.isDirty = false
      this.notifyStateChange()
      this.notifyDirtyChange()
    }
  }

  /**
   * Get the content checksum (JSON stringified content at last save/open)
   */
  public getContentChecksum(): string | null {
    return this.currentFile.contentChecksum
  }

  /**
   * Update the content checksum
   * Called by renderer when content is modified to track the initial state
   */
  public setContentChecksum(checksum: string): void {
    this.currentFile.contentChecksum = checksum
  }

  /**
   * Check if content has changed from the saved/opened state
   * @param currentChecksum JSON stringified current content
   * @returns true if content has changed
   */
  public hasContentChanged(currentChecksum: string): boolean {
    // If no checksum stored, consider no changes (file not yet opened)
    if (this.currentFile.contentChecksum === null) {
      return false
    }
    return this.currentFile.contentChecksum !== currentChecksum
  }

  /**
   * Get recent files
   */
  public getRecentFiles(): FileMetadata[] {
    // Filter and validate that files still exist
    const validFiles = this.recentFiles.filter((file) => this.fileExists(file.path))
    if (validFiles.length !== this.recentFiles.length) {
      this.recentFiles = validFiles
      this.saveRecentFiles()
    }
    return [...this.recentFiles]
  }

  /**
   * Get favorite files
   */
  public getFavorites(): FileMetadata[] {
    return this.recentFiles.filter((f) => f.isFavorite && this.fileExists(f.path))
  }

  /**
   * Toggle favorite status for a file
   */
  public toggleFavorite(path: string): boolean {
    const file = this.recentFiles.find((f) => f.path === path)
    if (file) {
      file.isFavorite = !file.isFavorite
      this.saveFavorites()
      this.notifyStateChange()
      return file.isFavorite
    }
    return false
  }

  /**
   * Remove a file from recent files
   */
  public removeFromRecent(path: string): void {
    this.recentFiles = this.recentFiles.filter((f) => f.path !== path)
    this.saveRecentFiles()
    this.saveFavorites()
    this.notifyStateChange()
  }

  /**
   * Subscribe to state changes
   */
  public onStateChanged(callback: (state: FileServiceState) => void): () => void {
    this.stateChangeCallbacks.add(callback)
    return () => {
      this.stateChangeCallbacks.delete(callback)
    }
  }

  /**
   * Subscribe to dirty state changes
   */
  public onDirtyChanged(callback: (isDirty: boolean) => void): () => void {
    this.dirtyChangeCallbacks.add(callback)
    return () => {
      this.dirtyChangeCallbacks.delete(callback)
    }
  }

  /**
   * Get the file extension
   */
  public getExtension(): string {
    return this.config.extension
  }

  /**
   * Update content without triggering save
   */
  public setContent(content: unknown): void {
    this.currentFile.content = content
  }

  /**
   * Get current content
   */
  public getContent(): unknown {
    return this.currentFile.content
  }
}

// Singleton instance
let fileServiceInstance: FileService | null = null

/**
 * Initialize the singleton instance of FileService
 */
export function initFileService(config?: Partial<FileServiceConfig>): FileService {
  if (fileServiceInstance) {
    logger.warn('FileService already initialized, returning existing instance')
    return fileServiceInstance
  }

  logger.info('FileService: Creating singleton instance...')
  fileServiceInstance = new FileService(config)
  return fileServiceInstance
}

/**
 * Get the singleton instance of FileService
 */
export function getFileService(): FileService {
  if (!fileServiceInstance) {
    throw new Error('FileService not initialized. Call initFileService() first.')
  }
  return fileServiceInstance
}

/**
 * Check if the service has been initialized
 */
export function isFileServiceInitialized(): boolean {
  return fileServiceInstance !== null
}
