import { ipcRenderer } from 'electron'

/**
 * Electron API object for window.electronAPI
 * This can be imported and reused in other preload scripts
 */
export const createElectronAPI = (): Record<string, unknown> => ({
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
  },
  onKeyboardShortcut: (cb: (shortcut: string) => void) => {
    ipcRenderer.on('keyboard-shortcut', (_: Electron.IpcRendererEvent, shortcut: string) => {
      cb(shortcut);
    });
  },
  /**
   * Register shortcuts that should be intercepted by the main process
   * These are shortcuts that Chromium would handle by default (Ctrl+N, Ctrl+O, etc.)
   */
  registerInterceptedShortcuts: (shortcuts: string[]) => {
    ipcRenderer.send('register-intercepted-shortcuts', shortcuts);
  },
  /**
   * Check if we're in dev mode (for enabling dev-specific shortcuts like Ctrl+Shift+R)
   */
  isDevMode: (): Promise<boolean> => {
    return ipcRenderer.invoke('is-dev-mode');
  }
})
