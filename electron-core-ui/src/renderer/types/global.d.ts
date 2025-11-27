// Global type definitions for electron-core-ui

declare global {
  interface Window {
    electronAPI?: {
      onPlatform: (callback: (platform: string) => void) => void
      onWindowState: (callback: (state: string) => void) => void
      sendAction: (action: string) => void
    }
  }
}

export {}
