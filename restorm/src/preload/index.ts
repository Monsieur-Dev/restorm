import { contextBridge, ipcRenderer } from 'electron'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from 'electron-core-ui/types/theme'
import { FIREWALL_REQUEST_RECORD_CHANNEL, type RequestRecord } from '../shared/types/firewall'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // Add your API methods here
  platform: process.platform,
  
  // Theme API
  theme: {
    list: (): Promise<ThemeInfo[]> => {
      return ipcRenderer.invoke('theme:list') as Promise<ThemeInfo[]>
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
  },

  // Developer Tools API
  toggleDeveloperTools: async (): Promise<void> => {
    await ipcRenderer.invoke('devtools:toggle')
  },

  // Project files API
  project: {
    listFiles: async (): Promise<{ path: string; isDirectory: boolean }[]> => {
      const result: unknown = await ipcRenderer.invoke('project:list-files')
      return result as { path: string; isDirectory: boolean }[]
    }
  },

  // Firewall + console feed. Phase 1: every intercepted outbound
  // call lands here as a `RequestRecord`. The console workbench tab
  // (Phase 2) subscribes; phases 4-5 add the audit log + status bar.
  // Returns an unsubscribe fn so the consumer can detach on unmount.
  firewall: {
    onRecord: (cb: (record: RequestRecord) => void): (() => void) => {
      const handler = (_event: unknown, record: RequestRecord): void => { cb(record) }
      ipcRenderer.on(FIREWALL_REQUEST_RECORD_CHANNEL, handler)
      return (): void => { ipcRenderer.off(FIREWALL_REQUEST_RECORD_CHANNEL, handler) }
    }
  }
})
