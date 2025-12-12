import { ipcRenderer } from 'electron'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../types/theme'

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
    get: async <T>(key: string): Promise<T | undefined> => {
      const result: unknown = await ipcRenderer.invoke('storage:get', key)
      return result as T | undefined
    },
    set: async <T>(key: string, value: T): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('storage:set', key, value)
      return result as boolean
    },
    delete: async (key: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('storage:delete', key)
      return result as boolean
    }
  }
})


