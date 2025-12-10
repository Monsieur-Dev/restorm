import type { ThemeInfo, ThemeDefinition, ThemeVariables } from './theme'

declare global {
  interface Window {
    api: {
      platform: string
      theme: {
        list: () => Promise<ThemeInfo[]>
        load: (themeId: string) => Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null>
        getCurrent: () => Promise<string | undefined>
        set: (themeId: string) => Promise<boolean>
        updateWCO: (colors: { backgroundColor: string; symbolColor: string }) => Promise<boolean>
        onThemeChanged: (callback: (themeId: string) => void) => (() => void)
      }
      logger: {
        log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>
      }
      minimizeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      toggleDeveloperTools: () => Promise<void>
      setWindowTitle: (title: string) => Promise<void>
      getWindowIcon: () => Promise<string | undefined>
      // Tabs aux-window helpers
      getCursorScreenPoint: () => Promise<{ x: number; y: number; display?: { x: number; y: number; width: number; height: number } }>
      getActiveWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
      getCurrentWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number; windowId: number }>
      createAuxWindow: (payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number; height?: number }) => Promise<void>
      getWindowUnderCursor: () => Promise<{ windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null>
      sendWorkbenchTabToWindow: (targetWindowId: number, tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => Promise<boolean>
      onWorkbenchTabDropped: (callback: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => void) => (() => void)
    }
  }
}

declare module '*?raw' {
  const content: string
  export default content
}

export {}

