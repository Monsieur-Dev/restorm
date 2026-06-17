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
  },
  /**
   * Signal that the renderer is FULLY mounted (real UI painted, e.g. once a
   * lazy/Suspense root has resolved and i18n is ready) — not merely that the
   * page finished its first paint. The main process uses this to reveal a
   * window created with `showWhenReady` and close the boot splash, so the user
   * never sees an intermediate loading state. Call once, from the real app's
   * first mount, after the loading fallback is gone.
   */
  notifyReady: (): void => {
    ipcRenderer.send('app:renderer-ready');
  }
})
