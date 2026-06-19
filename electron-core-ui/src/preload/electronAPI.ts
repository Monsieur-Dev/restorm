import { ipcRenderer } from 'electron'

/** Removes a previously-registered IPC event listener. */
export type Disposer = () => void

/**
 * Typed surface of the `window.electronAPI` bridge exposed by the preload.
 * Replacing the previous `Record<string, unknown>` return gives renderer
 * consumers real type-checking instead of casting `window` to an ad-hoc shape.
 *
 * The `on*` subscriptions return a {@link Disposer} so a consumer that
 * re-subscribes (or tears down) can remove its listener — without it,
 * `ipcRenderer.on` accumulates duplicate listeners that each fire on every
 * event.
 */
export interface ElectronAPI {
  onPlatform: (cb: (platform: string) => void) => Disposer
  onWindowState: (cb: (state: string) => void) => Disposer
  sendAction: (action: string) => void
  onKeyboardShortcut: (cb: (shortcut: string) => void) => Disposer
  registerInterceptedShortcuts: (shortcuts: string[]) => void
  isDevMode: () => Promise<boolean>
  notifyReady: () => void
}

/**
 * Electron API object for window.electronAPI
 * This can be imported and reused in other preload scripts
 */
export const createElectronAPI = (): ElectronAPI => ({
  onPlatform: (cb: (platform: string) => void): Disposer => {
    const listener = (_: Electron.IpcRendererEvent, platform: string): void => { cb(platform) }
    ipcRenderer.on('platform', listener)
    // Request platform immediately
    ipcRenderer.send('request-platform')
    return () => { ipcRenderer.removeListener('platform', listener) }
  },
  onWindowState: (cb: (state: string) => void): Disposer => {
    const listener = (_: Electron.IpcRendererEvent, state: string): void => { cb(state) }
    ipcRenderer.on('window-state', listener)
    return () => { ipcRenderer.removeListener('window-state', listener) }
  },
  sendAction: (action: string): void => {
    ipcRenderer.send('window-action', action)
  },
  onKeyboardShortcut: (cb: (shortcut: string) => void): Disposer => {
    const listener = (_: Electron.IpcRendererEvent, shortcut: string): void => { cb(shortcut) }
    ipcRenderer.on('keyboard-shortcut', listener)
    return () => { ipcRenderer.removeListener('keyboard-shortcut', listener) }
  },
  /**
   * Register shortcuts that should be intercepted by the main process
   * These are shortcuts that Chromium would handle by default (Ctrl+N, Ctrl+O, etc.)
   */
  registerInterceptedShortcuts: (shortcuts: string[]): void => {
    ipcRenderer.send('register-intercepted-shortcuts', shortcuts)
  },
  /**
   * Check if we're in dev mode (for enabling dev-specific shortcuts like Ctrl+Shift+R)
   */
  isDevMode: (): Promise<boolean> => {
    return ipcRenderer.invoke('is-dev-mode')
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
    ipcRenderer.send('app:renderer-ready')
  }
})
