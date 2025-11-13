import { contextBridge } from 'electron'
import { createCoreUIAPI } from './api'
import { createElectronAPI } from './electronAPI'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', createCoreUIAPI())
contextBridge.exposeInMainWorld('electronAPI', createElectronAPI())