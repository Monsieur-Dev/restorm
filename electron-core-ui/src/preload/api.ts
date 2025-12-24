import { ipcRenderer } from 'electron'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../types/theme'
import type { FeaturePlatform } from '../../types/feature'
import type { FileServiceState, FileMetadata, SerializationFormat } from '../../types/file'

/**
 * Core UI API object for window.api
 * This can be imported and reused in other preload scripts
 */
export const createCoreUIAPI = (): Record<string, unknown> => ({
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
  createAuxWindow: async (payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number; height?: number }): Promise<void> => {
    await ipcRenderer.invoke('tabs:create-aux-window', payload, bounds)
  },
  getWindowUnderCursor: async (): Promise<{ windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null> => {
    const result: unknown = await ipcRenderer.invoke('tabs:get-window-under-cursor')
    return result as { windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null
  },
  sendWorkbenchTabToWindow: async (targetWindowId: number, tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): Promise<boolean> => {
    const result: unknown = await ipcRenderer.invoke('tabs:send-workbench-tab-to-window', targetWindowId, tabData)
    return result as boolean
  },
  onWorkbenchTabDropped: (callback: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): void => {
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
    markDirty: async (): Promise<void> => {
      await ipcRenderer.invoke('file:mark-dirty')
    },
    clearDirty: async (): Promise<void> => {
      await ipcRenderer.invoke('file:clear-dirty')
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
      description?: string
      category: string
      icon?: string
      keywords?: string
      navigation?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('search:index-document', doc)
      return result as boolean
    },
    indexDocuments: async (docs: {
      id: string
      title: string
      description?: string
      category: string
      icon?: string
      keywords?: string
      navigation?: Record<string, unknown>
      metadata?: Record<string, unknown>
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
  }
})
