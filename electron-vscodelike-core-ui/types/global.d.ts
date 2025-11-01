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
    }
  }
}

export {}

