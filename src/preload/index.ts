import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // Add your API methods here
  platform: process.platform
})

// Expose settings API
contextBridge.exposeInMainWorld('settingsAPI', {
  getSchema: () => ipcRenderer.invoke('settings:get-schema'),
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  resetSetting: (key: string) => ipcRenderer.invoke('settings:reset', key),
  searchSettings: (query: string) => ipcRenderer.invoke('settings:search', query),
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  onLanguageChanged: (callback: (language: string) => void) => {
    ipcRenderer.on('settings:language-changed', (_event, language: string) => {
      callback(language)
    })
  }
})

