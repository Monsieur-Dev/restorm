import { ipcRenderer } from 'electron'

/**
 * Electron API object for window.electronAPI
 * This can be imported and reused in other preload scripts
 */
export const createElectronAPI = () => ({
  onPlatform: (cb: (platform: string) => void) => {
    ipcRenderer.on('platform', (_: Electron.IpcRendererEvent, platform: string) => {
      cb(platform);
    });
    // Request platform immediately
    ipcRenderer.send('request-platform');
  },
  onWindowState: (cb: (state: string) => void) => {
    ipcRenderer.on('window-state', (_: Electron.IpcRendererEvent, state: string) => { cb(state); });
  },
  sendAction: (action: string) => {
    ipcRenderer.send('window-action', action);
  }
})


