import { contextBridge, ipcRenderer } from 'electron'
// Import from core-ui preload modules using relative paths
// This works in both dev and prod because:
// - In dev: Vite resolves these imports via aliases in electron.vite.config.ts
// - In prod: These are bundled into the preload script
import { createCoreUIAPI } from '../../../../electron-core-ui/src/preload/api'
import { createElectronAPI } from '../../../../electron-core-ui/src/preload/electronAPI'

// Expose core-ui APIs (imported from core-ui preload modules) and extend with restorm project API
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

/** Variable transformation result from context service */
interface VariableTransformResult {
  variableId: string
  contextUsed: Record<string, string>
  transformedValue: string
  rawValue: string
  key: string
}

// Expose restorm-specific APIs
contextBridge.exposeInMainWorld('restorm', {
  openEditor: async (file?: { title: string; content?: string; x?: number; y?: number }): Promise<void> => {
    await ipcRenderer.invoke('restorm:open-editor', file)
  },
  getEditorFile: async (): Promise<{ title: string; content?: string } | undefined> => {
    const result: unknown = await ipcRenderer.invoke('restorm:get-editor-file')
    return result as { title: string; content?: string } | undefined
  },
  forceClose: async (): Promise<void> => {
    await ipcRenderer.invoke('restorm:force-close')
  },
  onSaveAndClose: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }
    ipcRenderer.on('app:save-and-close', handler)
    return () => {
      ipcRenderer.removeListener('app:save-and-close', handler)
    }
  },
  context: {
    /** Get all variable transformation results */
    getAllTransformResults: async (): Promise<Record<string, VariableTransformResult>> => {
      const result: unknown = await ipcRenderer.invoke('context:get-all-transform-results')
      return result as Record<string, VariableTransformResult>
    },
    /** Listen for variable transformation updates */
    onVariableTransformed: (callback: (result: VariableTransformResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: VariableTransformResult): void => {
        callback(result)
      }
      ipcRenderer.on('context:variable-transformed', handler)
      return () => {
        ipcRenderer.removeListener('context:variable-transformed', handler)
      }
    }
  }
})
