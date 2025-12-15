import { contextBridge, ipcRenderer } from 'electron'
// Import from core-ui preload modules using relative paths
// This works in both dev and prod because:
// - In dev: Vite resolves these imports via aliases in electron.vite.config.ts
// - In prod: These are bundled into the preload script
import { createCoreUIAPI } from '../../../../electron-core-ui/src/preload/api'
import { createElectronAPI } from '../../../../electron-core-ui/src/preload/electronAPI'

// Expose core-ui APIs (imported from core-ui preload modules) and extend with Gitable project API
const coreUIAPI = createCoreUIAPI()

contextBridge.exposeInMainWorld('api', {
  ...coreUIAPI,
  project: {
    listFiles: async (): Promise<{ path: string; isDirectory: boolean }[]> => {
      const result: unknown = await ipcRenderer.invoke('project:list-files')
      return result as { path: string; isDirectory: boolean }[]
    },
    readFile: async (filePath: string): Promise<string> => {
      const result: unknown = await ipcRenderer.invoke('project:read-file', filePath)
      return typeof result === 'string' ? result : ''
    }
  }
})
contextBridge.exposeInMainWorld('electronAPI', createElectronAPI())

// Expose gitable-specific APIs
contextBridge.exposeInMainWorld('gitable', {
  openEditor: async (file?: { title: string; content?: string; x?: number; y?: number }): Promise<void> => {
    await ipcRenderer.invoke('gitable:open-editor', file)
  },
  getEditorFile: async (): Promise<{ title: string; content?: string } | undefined> => {
    const result: unknown = await ipcRenderer.invoke('gitable:get-editor-file')
    return result as { title: string; content?: string } | undefined
  }
})
