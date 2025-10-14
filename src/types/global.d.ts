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
      }
      logger: {
        log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>
      }
    }
  }
}

export {}

