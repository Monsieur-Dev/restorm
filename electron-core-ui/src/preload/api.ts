import { ipcRenderer } from 'electron'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../types/theme'
import type { FeaturePlatform } from '../types/feature'
import type { FileServiceState, FileMetadata, SerializationFormat } from '../types/file'
import type { SettingValue, ResolvedSetting, SettingsGroup } from '../types/settings'
import type { CoreUiApi } from '../types/api'

/**
 * Core UI API object for window.api
 * This can be imported and reused in other preload scripts
 */
export const createCoreUIAPI = (): CoreUiApi => ({
  platform: process.platform,
  
  // Theme API
  theme: {
    list: async (): Promise<ThemeInfo[]> => {
      const result: unknown = await ipcRenderer.invoke('theme:list')
      return result as ThemeInfo[]
    },
    load: async (themeId: string): Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null> => {
      const result: unknown = await ipcRenderer.invoke('theme:load', themeId)
      return result as { theme: ThemeDefinition; variables: ThemeVariables } | null
    },
    getCurrent: async (): Promise<string | undefined> => {
      const result: unknown = await ipcRenderer.invoke('theme:get-current')
      return result as string | undefined
    },
    set: async (themeId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('theme:set', themeId)
      return result as boolean
    },
    updateWCO: async (colors: { backgroundColor: string; symbolColor: string }): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('theme:update-wco', colors)
      return result as boolean
    },
    onThemeChanged: (callback: (themeId: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, themeId: string): void => {
        callback(themeId)
      }
      ipcRenderer.on('theme:changed', handler)
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('theme:changed', handler)
      }
    }
  },

  // I18n API (main process language synchronization)
  i18n: {
    setLanguage: async (language: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('i18n:set-language', language)
      return result as boolean
    },
    getLanguage: async (): Promise<string> => {
      const result: unknown = await ipcRenderer.invoke('i18n:get-language')
      return result as string
    }
  },

  // Logger API
  logger: {
    log: async (level: string, message: string, meta?: Record<string, unknown>): Promise<void> => {
      await ipcRenderer.invoke('logger:log', { level, message, meta })
    }
  },

  // Window controls API
  minimizeWindow: async (): Promise<void> => {
    await ipcRenderer.invoke('minimize-window')
  },
  
  maximizeWindow: async (): Promise<void> => {
    await ipcRenderer.invoke('maximize-window')
  },
  
  closeWindow: async (): Promise<void> => {
    await ipcRenderer.invoke('close-window')
  },

  // Developer Tools API
  toggleDeveloperTools: async (): Promise<void> => {
    await ipcRenderer.invoke('devtools:toggle')
  },

  // Tabs: Aux window helpers
  getCursorScreenPoint: async (): Promise<{ x: number; y: number; display?: { x: number; y: number; width: number; height: number } }> => {
    const result: unknown = await ipcRenderer.invoke('tabs:get-cursor-screen-point')
    return result as { x: number; y: number; display?: { x: number; y: number; width: number; height: number } }
  },
  getActiveWindowBounds: async (): Promise<{ x: number; y: number; width: number; height: number }> => {
    const result: unknown = await ipcRenderer.invoke('tabs:get-active-window-bounds')
    return result as { x: number; y: number; width: number; height: number }
  },
  getCurrentWindowBounds: async (): Promise<{ x: number; y: number; width: number; height: number; windowId: number }> => {
    const result: unknown = await ipcRenderer.invoke('tabs:get-current-window-bounds')
    return result as { x: number; y: number; width: number; height: number; windowId: number }
  },
  createAuxWindow: async (payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number | undefined; height?: number | undefined }): Promise<void> => {
    await ipcRenderer.invoke('tabs:create-aux-window', payload, bounds)
  },
  getWindowUnderCursor: async (): Promise<{ windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null> => {
    const result: unknown = await ipcRenderer.invoke('tabs:get-window-under-cursor')
    return result as { windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null
  },
  sendWorkbenchTabToWindow: async (targetWindowId: number, tabData: { tabId: string; title: string; groupId: string; content?: string | undefined; cursorX?: number | undefined; cursorY?: number | undefined }): Promise<boolean> => {
    const result: unknown = await ipcRenderer.invoke('tabs:send-workbench-tab-to-window', targetWindowId, tabData)
    return result as boolean
  },
  onWorkbenchTabDropped: (callback: (tabData: { tabId: string; title: string; groupId: string; content?: string | undefined; cursorX?: number | undefined; cursorY?: number | undefined }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tabData: { tabId: string; title: string; groupId: string; content?: string | undefined; cursorX?: number | undefined; cursorY?: number | undefined }): void => {
      callback(tabData)
    }
    ipcRenderer.on('tabs:workbench-tab-dropped', handler)
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('tabs:workbench-tab-dropped', handler)
    }
  },

  // Window title API
  setWindowTitle: (title: string): void => {
    ipcRenderer.send('set-window-title', title)
  },

  // Window icon API
  getWindowIcon: async (): Promise<string | undefined> => {
    const result: unknown = await ipcRenderer.invoke('get-window-icon')
    return result as string | undefined
  },

  // Storage API for persisting application data
  storage: {
    get: async (key: string): Promise<unknown> => {
      return await ipcRenderer.invoke('storage:get', key)
    },
    set: async (key: string, value: unknown): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('storage:set', key, value)
      return result as boolean
    },
    delete: async (key: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('storage:delete', key)
      return result as boolean
    }
  },

  // Feature Flipping API
  feature: {
    isEnabled: async (featureName: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('feature:is-enabled', featureName)
      return result as boolean
    },
    getPlatform: async (): Promise<FeaturePlatform> => {
      const result: unknown = await ipcRenderer.invoke('feature:get-platform')
      return result as FeaturePlatform
    }
  },

  // File Service API
  file: {
    newFile: async (): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:new')
      return result as boolean
    },
    open: async (path?: string): Promise<{ success: boolean; content?: unknown }> => {
      const result: unknown = await ipcRenderer.invoke('file:open', path)
      return result as { success: boolean; content?: unknown }
    },
    save: async (content: unknown): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:save', content)
      return result as boolean
    },
    saveAs: async (content: unknown, filename?: string, format?: SerializationFormat): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:save-as', content, filename, format)
      return result as boolean
    },
    close: async (): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:close')
      return result as boolean
    },
    getState: async (): Promise<FileServiceState | null> => {
      const result: unknown = await ipcRenderer.invoke('file:get-state')
      return result as FileServiceState | null
    },
    getFileName: async (): Promise<string | null> => {
      const result: unknown = await ipcRenderer.invoke('file:get-name')
      return result as string | null
    },
    getFilePath: async (): Promise<string | null> => {
      const result: unknown = await ipcRenderer.invoke('file:get-path')
      return result as string | null
    },
    isDirty: async (): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:is-dirty')
      return result as boolean
    },
    finishLoading: async (): Promise<void> => {
      await ipcRenderer.invoke('file:finish-loading')
    },
    showUnsavedChangesDialog: async (labels?: {
      title?: string
      message?: string
      detail?: string
      save?: string
      dontSave?: string
      cancel?: string
    }): Promise<'save' | 'discard' | 'cancel'> => {
      const result: unknown = await ipcRenderer.invoke('file:show-unsaved-dialog', labels)
      return result as 'save' | 'discard' | 'cancel'
    },
    getRecentFiles: async (): Promise<FileMetadata[]> => {
      const result: unknown = await ipcRenderer.invoke('file:get-recent')
      return result as FileMetadata[]
    },
    getFavorites: async (): Promise<FileMetadata[]> => {
      const result: unknown = await ipcRenderer.invoke('file:get-favorites')
      return result as FileMetadata[]
    },
    toggleFavorite: async (path: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:toggle-favorite', path)
      return result as boolean
    },
    removeFromRecent: async (path: string): Promise<void> => {
      await ipcRenderer.invoke('file:remove-from-recent', path)
    },
    getContentChecksum: async (): Promise<string | null> => {
      const result: unknown = await ipcRenderer.invoke('file:get-content-checksum')
      return result as string | null
    },
    setContentChecksum: async (checksum: string): Promise<void> => {
      await ipcRenderer.invoke('file:set-content-checksum', checksum)
    },
    hasContentChanged: async (currentChecksum: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:has-content-changed', currentChecksum)
      return result as boolean
    },
    // Save unit v2 API
    hydrateSaveUnit: async (params: {
      runtimeId: string
      kind: 'file' | 'folder'
      reference: unknown
      parentId?: string
    }): Promise<void> => {
      await ipcRenderer.invoke('file:hydrate-save-unit', params)
    },
    upsertSaveUnit: async (params: {
      runtimeId: string
      kind: 'file' | 'folder'
      draft: unknown
      reason?: 'modify' | 'create' | 'delete' | 'rename' | 'move' | 'reorder'
      parentId?: string
    }): Promise<void> => {
      await ipcRenderer.invoke('file:upsert-save-unit', params)
    },
    markSaveUnitDeleted: async (runtimeId: string): Promise<void> => {
      await ipcRenderer.invoke('file:mark-save-unit-deleted', runtimeId)
    },
    commitSaveUnit: async (runtimeId: string): Promise<void> => {
      await ipcRenderer.invoke('file:commit-save-unit', runtimeId)
    },
    revertSaveUnit: async (runtimeId: string): Promise<void> => {
      await ipcRenderer.invoke('file:revert-save-unit', runtimeId)
    },
    getSaveUnitsSnapshot: async (): Promise<{
      isDirty: boolean
      dirtyCount: number
      dirtyUnits: { runtimeId: string; reason?: string }[]
    }> => {
      const result: unknown = await ipcRenderer.invoke('file:get-save-units-snapshot')
      return result as {
        isDirty: boolean
        dirtyCount: number
        dirtyUnits: { runtimeId: string; reason?: string }[]
      }
    },
    onUnitDirtyChanged: (
      callback: (payload: { runtimeId: string; isDirty: boolean; reason?: string }) => void
    ): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { runtimeId: string; isDirty: boolean; reason?: string }): void => {
        callback(payload)
      }
      ipcRenderer.on('file:unit-dirty-changed', handler)
      return () => {
        ipcRenderer.removeListener('file:unit-dirty-changed', handler)
      }
    },
    onDraftsRestored: (
      callback: (payload: { count: number }) => void
    ): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { count: number }): void => {
        callback(payload)
      }
      ipcRenderer.on('file:drafts-restored', handler)
      return () => {
        ipcRenderer.removeListener('file:drafts-restored', handler)
      }
    },
    onAutoSaveTrigger: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('file:autosave-trigger', handler)
      return () => {
        ipcRenderer.removeListener('file:autosave-trigger', handler)
      }
    },
    saveUnit: async (entry: {
      runtimeId: string
      content: unknown
      absolutePath: string
      format: 'json' | 'json5' | 'yaml'
    }): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('file:save-unit', entry)
      return result as boolean
    },
    saveUnitsBatch: async (
      entries: { runtimeId: string; content: unknown; absolutePath: string; format: 'json' | 'json5' | 'yaml' }[]
    ): Promise<{ runtimeId: string; success: boolean }[]> => {
      const result: unknown = await ipcRenderer.invoke('file:save-units-batch', entries)
      return result as { runtimeId: string; success: boolean }[]
    },
    onStateChanged: (callback: (state: FileServiceState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: FileServiceState): void => {
        callback(state)
      }
      ipcRenderer.on('file:state-changed', handler)
      return () => {
        ipcRenderer.removeListener('file:state-changed', handler)
      }
    },
    onDirtyChanged: (callback: (isDirty: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, isDirty: boolean): void => {
        callback(isDirty)
      }
      ipcRenderer.on('file:dirty-changed', handler)
      return () => {
        ipcRenderer.removeListener('file:dirty-changed', handler)
      }
    },
    onFileOpened: (callback: (state: FileServiceState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: FileServiceState): void => {
        callback(state)
      }
      ipcRenderer.on('file:opened', handler)
      return () => {
        ipcRenderer.removeListener('file:opened', handler)
      }
    },
    onFileClosed: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('file:closed', handler)
      return () => {
        ipcRenderer.removeListener('file:closed', handler)
      }
    }
  },

  // EventBus API (main process)
  eventBus: {
    emit: async (event: string, payload: unknown): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('eventbus:emit', event, payload)
      return result as boolean
    },
    emitSync: async (event: string, payload: unknown): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('eventbus:emit-sync', event, payload)
      return result as boolean
    }
  },

  // Search Service API (main process)
  search: {
    registerCategories: async (categories: Record<string, { label: string; icon: string; order: number }>): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('search:register-categories', categories)
      return result as boolean
    },
    indexDocument: async (doc: {
      id: string
      title: string
      description?: string | undefined
      category: string
      icon?: string | undefined
      keywords?: string | undefined
      navigation?: Record<string, unknown> | undefined
      metadata?: Record<string, unknown> | undefined
    }): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('search:index-document', doc)
      return result as boolean
    },
    indexDocuments: async (docs: {
      id: string
      title: string
      description?: string | undefined
      category: string
      icon?: string | undefined
      keywords?: string | undefined
      navigation?: Record<string, unknown> | undefined
      metadata?: Record<string, unknown> | undefined
    }[]): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('search:index-documents', docs)
      return result as boolean
    },
    removeDocument: async (id: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('search:remove-document', id)
      return result as boolean
    },
    clearIndex: async (): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('search:clear-index')
      return result as boolean
    },
    search: async (query: string): Promise<{
      category: string
      label: string
      icon: string
      items: {
        id: string
        title: string
        description?: string
        category: string
        icon?: string
        keywords?: string
        navigation?: Record<string, unknown>
        metadata?: Record<string, unknown>
        score: number
      }[]
    }[]> => {
      const result: unknown = await ipcRenderer.invoke('search:search', query)
      return result as {
        category: string
        label: string
        icon: string
        items: {
          id: string
          title: string
          description?: string
          category: string
          icon?: string
          keywords?: string
          navigation?: Record<string, unknown>
          metadata?: Record<string, unknown>
          score: number
        }[]
      }[]
    },
    getDocumentCount: async (): Promise<number> => {
      const result: unknown = await ipcRenderer.invoke('search:get-document-count')
      return result as number
    }
  },

  // Settings Service API
  settings: {
    get: async (storageKey: string): Promise<SettingValue | null> => {
      const result: unknown = await ipcRenderer.invoke('settings:get', storageKey)
      return result as SettingValue | null
    },
    set: async (storageKey: string, value: SettingValue): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('settings:set', storageKey, value)
      return result as boolean
    },
    getAll: async (): Promise<ResolvedSetting[]> => {
      const result: unknown = await ipcRenderer.invoke('settings:get-all')
      return result as ResolvedSetting[]
    },
    getGroups: async (): Promise<SettingsGroup[]> => {
      const result: unknown = await ipcRenderer.invoke('settings:get-groups')
      return result as SettingsGroup[]
    },
    search: async (query: string): Promise<ResolvedSetting[]> => {
      const result: unknown = await ipcRenderer.invoke('settings:search', query)
      return result as ResolvedSetting[]
    },
    reset: async (storageKey: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('settings:reset', storageKey)
      return result as boolean
    },
    reindex: async (): Promise<void> => {
      await ipcRenderer.invoke('settings:reindex')
    },
    onSettingChanged: (callback: (storageKey: string, value: SettingValue) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, storageKey: string, value: SettingValue): void => {
        callback(storageKey, value)
      }
      ipcRenderer.on('settings:changed', handler)
      return () => {
        ipcRenderer.removeListener('settings:changed', handler)
      }
    },
    onConfigLoaded: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('settings:config-loaded', handler)
      return () => {
        ipcRenderer.removeListener('settings:config-loaded', handler)
      }
    },
    // ── Workspace overlay ─────────────────────────────────────────
    getWorkspacePath: async (): Promise<string | null> => {
      const result: unknown = await ipcRenderer.invoke('settings:get-workspace-path')
      return result as string | null
    },
    getWorkspaceValues: async (): Promise<Record<string, SettingValue>> => {
      const result: unknown = await ipcRenderer.invoke('settings:get-workspace-values')
      return (result ?? {}) as Record<string, SettingValue>
    },
    getWorkspaceValue: async (storageKey: string): Promise<SettingValue | null> => {
      const result: unknown = await ipcRenderer.invoke('settings:get-workspace-value', storageKey)
      return result === null || result === undefined ? null : (result as SettingValue)
    },
    setWorkspaceValue: async (storageKey: string, value: SettingValue): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('settings:set-workspace-value', storageKey, value)
      return result as boolean
    },
    resetWorkspaceValue: async (storageKey: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('settings:reset-workspace-value', storageKey)
      return result as boolean
    },
    getResolvedValue: async (storageKey: string): Promise<{
      storageKey: string
      effective: SettingValue
      source: 'workspace' | 'user' | 'default'
      overriddenBy?: 'workspace'
    } | null> => {
      const result: unknown = await ipcRenderer.invoke('settings:get-resolved-value', storageKey)
      return result as {
        storageKey: string
        effective: SettingValue
        source: 'workspace' | 'user' | 'default'
        overriddenBy?: 'workspace'
      } | null
    },
    onWorkspaceChanged: (callback: (path: string | null) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, path: string | null): void => {
        callback(path)
      }
      ipcRenderer.on('settings:workspace-changed', handler)
      return () => {
        ipcRenderer.removeListener('settings:workspace-changed', handler)
      }
    }
  }
})
