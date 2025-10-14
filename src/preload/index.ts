import { contextBridge, ipcRenderer } from 'electron'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../types/theme'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // Add your API methods here
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
    }
  },

  // Logger API
  logger: {
    log: async (level: string, message: string, meta?: Record<string, unknown>): Promise<void> => {
      await ipcRenderer.invoke('logger:log', { level, message, meta })
    }
  }
})

