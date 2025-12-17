// Lightweight runtime shim to make electron-core-ui usable in pure web builds
// (without Electron preload defining window.api). In a real Electron renderer,
// the preload script will have already populated window.api, so this shim is
// effectively a no-op.

import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../types/theme'
import yaml from 'js-yaml'
import themeIndexJson from '../../resources/themes/index.json'

// Dynamically import all theme YAML files using Vite's glob import
const themeYamlModules = import.meta.glob<string>('../../resources/themes/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true
})

// Helper to extract theme ID from file path
function getThemeIdFromPath(path: string): string {
  // Path format: ../../resources/themes/dark/abyss.yaml -> dark/abyss
  const match = path.match(/themes\/(.+)\.yaml$/)
  return match?.[1] ?? ''
}

// Build mappings from glob imports
const baseYaml = themeYamlModules['../../resources/themes/base.yaml'] ?? ''
const darkBaseYaml = themeYamlModules['../../resources/themes/dark/_base.yaml'] ?? ''
const lightBaseYaml = themeYamlModules['../../resources/themes/light/_base.yaml'] ?? ''
const hcDarkBaseYaml = themeYamlModules['../../resources/themes/hc_dark/_base.yaml'] ?? ''
const hcLightBaseYaml = themeYamlModules['../../resources/themes/hc_light/_base.yaml'] ?? ''

interface WindowApiThemeShim {
  list: () => Promise<ThemeInfo[]>
  load: (themeId: string) => Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null>
  getCurrent: () => Promise<string | undefined>
  set: (themeId: string) => Promise<boolean>
  updateWCO: (colors: { backgroundColor: string; symbolColor: string }) => Promise<boolean>
  onThemeChanged: (callback: (themeId: string) => void) => () => void
}

interface WindowApiStorageShim {
  get: <T>(key: string) => Promise<T | undefined>
  set: <T>(key: string, value: T) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

interface WindowApiShim {
  platform: string
  theme: WindowApiThemeShim
  logger: {
    log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>
  }
  storage: WindowApiStorageShim
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  toggleDeveloperTools: () => Promise<void>
  setWindowTitle: (title: string) => Promise<void>
  getWindowIcon: () => Promise<string | undefined>
  getCursorScreenPoint: () => Promise<{ x: number; y: number; display?: { x: number; y: number; width: number; height: number } }>
  getActiveWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  getCurrentWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number; windowId: number }>
  createAuxWindow: (payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number; height?: number }) => Promise<void>
  getWindowUnderCursor: () => Promise<{ windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null>
  sendWorkbenchTabToWindow: (
    targetWindowId: number,
    tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }
  ) => Promise<boolean>
  onWorkbenchTabDropped: (
    callback: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => void
  ) => () => void
}

type ThemeTypeInternal = 'dark' | 'light' | 'hc_dark' | 'hc_light'

interface ThemeIndexEntry {
  id: string
  name: string
  type: ThemeTypeInternal
  description?: string
  file: string
}

interface ThemeIndex {
  themes: ThemeIndexEntry[]
}

interface YamlColorEntry {
  id: string
  value: string
}

interface YamlVariableEntry {
  id: string
  value: string
}

interface YamlBaseFile {
  variables?: YamlVariableEntry[]
}

interface YamlTypeBaseFile {
  colors?: YamlColorEntry[]
}

interface YamlThemeFile {
  name: string
  description?: string
  colors?: Record<string, string>
}

interface ThemeCacheValue { theme: ThemeDefinition; variables: ThemeVariables }

const themeIndex = themeIndexJson as ThemeIndex

// Build theme YAML mapping dynamically from glob imports
const THEME_YAML_BY_ID: Record<string, string> = {}
for (const [path, content] of Object.entries(themeYamlModules)) {
  const themeId = getThemeIdFromPath(path)
  // Skip base files and root base.yaml
  if (themeId && !themeId.endsWith('/_base') && themeId !== 'base') {
    THEME_YAML_BY_ID[themeId] = content
  }
}

let webBaseVariables: ThemeVariables | null = null
const webTypeBaseColors: Record<ThemeTypeInternal, Record<string, string>> = {
  dark: {},
  light: {},
  hc_dark: {},
  hc_light: {}
}
const webThemeCache = new Map<string, ThemeCacheValue>()

function mapThemeTypeInternalToInfo(type: ThemeTypeInternal): ThemeInfo['type'] {
  switch (type) {
    case 'dark':
      return 'dark'
    case 'light':
      return 'light'
    case 'hc_dark':
      return 'hcDark'
    case 'hc_light':
      return 'hcLight'
    default:
      return 'dark'
  }
}

function ensureWebBaseLoaded(): void {
  if (webBaseVariables) return

  webBaseVariables = {}

  // base.yaml
  try {
    const parsed = yaml.load(baseYaml) as YamlBaseFile
    if (parsed.variables) {
      for (const v of parsed.variables) {
        const cssVar = `--${v.id}`
        webBaseVariables[cssVar] = v.value
      }
    }
  } catch {
    // ignore in web
  }

  const typeBaseSources: Record<ThemeTypeInternal, string> = {
    dark: darkBaseYaml,
    light: lightBaseYaml,
    hc_dark: hcDarkBaseYaml,
    hc_light: hcLightBaseYaml
  }

  for (const type of Object.keys(typeBaseSources) as ThemeTypeInternal[]) {
    try {
      const parsed = yaml.load(typeBaseSources[type]) as YamlTypeBaseFile
      if (parsed.colors) {
        for (const c of parsed.colors) {
          const cssVar = `--vscode-${c.id.replace(/\./g, '-')}`
          webTypeBaseColors[type][cssVar] = c.value
        }
      }
    } catch {
      // ignore in web
    }
  }
}

function webListThemes(): ThemeInfo[] {
  ensureWebBaseLoaded()
  return themeIndex.themes.map((entry) => ({
    id: entry.id,
    name: entry.name,
    type: mapThemeTypeInternalToInfo(entry.type),
    path: entry.file
  }))
}

function webLoadTheme(themeId: string): ThemeCacheValue | null {
  ensureWebBaseLoaded()

  const cached = webThemeCache.get(themeId)
  if (cached) return cached

  const entry = themeIndex.themes.find((t) => t.id === themeId)
  if (!entry) return null

  const yamlSource = THEME_YAML_BY_ID[entry.id]
  if (!yamlSource) return null

  let parsed: YamlThemeFile
  try {
    parsed = yaml.load(yamlSource) as YamlThemeFile
  } catch {
    return null
  }

  const variables: ThemeVariables = {
    ...(webBaseVariables ?? {}),
    ...webTypeBaseColors[entry.type]
  }

  const colors: Record<string, string> = {}

  for (const [cssVar, val] of Object.entries(webTypeBaseColors[entry.type])) {
    if (cssVar.startsWith('--vscode-')) {
      const key = cssVar.slice(9).replace(/-/g, '.')
      colors[key] = val
    }
  }

  if (parsed.colors) {
    for (const [key, value] of Object.entries(parsed.colors)) {
      const cssVar = `--vscode-${key.replace(/\./g, '-')}`
      variables[cssVar] = value
      colors[key] = value
    }
  }

  const theme: ThemeDefinition = {
    name: parsed.name,
    type: mapThemeTypeInternalToInfo(entry.type),
    colors
  }

  const value: ThemeCacheValue = { theme, variables }
  webThemeCache.set(themeId, value)
  return value
}

export function ensureCoreUiWebApiShim(): void {
  if (typeof window === 'undefined') {
    return
  }

  const w: Record<string, unknown> = window as unknown as Record<string, unknown>

  // If preload already injected a real API (Electron), do nothing.
  if ('api' in w && w['api']) {
    return
  }

  const themeApi: WindowApiThemeShim = {
    list: () => Promise.resolve(webListThemes()),
    load: (themeId: string) => Promise.resolve(webLoadTheme(themeId)),
    getCurrent: () => {
      // Default to first dark theme if available
      const themes: ThemeInfo[] = webListThemes()
      const darkTheme: ThemeInfo | undefined = themes.find((t) => t.type === 'dark')
      const firstTheme: ThemeInfo | undefined = themes[0]
      const selectedTheme = darkTheme ?? firstTheme
      return Promise.resolve(selectedTheme?.id)
    },
    set: () => Promise.resolve(true),
    updateWCO: () => Promise.resolve(true),
    onThemeChanged: (_callback: (themeId: string) => void) => () => {
      // no-op in web shim
    }
  }

  // Storage shim using localStorage for web builds
  const storageApi: WindowApiStorageShim = {
    get: <T>(key: string): Promise<T | undefined> => {
      try {
        const item = localStorage.getItem(`ecui_${key}`)
        return Promise.resolve(item ? JSON.parse(item) as T : undefined)
      } catch {
        return Promise.resolve(undefined)
      }
    },
    set: <T>(key: string, value: T): Promise<boolean> => {
      try {
        localStorage.setItem(`ecui_${key}`, JSON.stringify(value))
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    },
    delete: (key: string): Promise<boolean> => {
      try {
        localStorage.removeItem(`ecui_${key}`)
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    }
  }

  const api: WindowApiShim = {
    platform: navigator.platform || 'web',
    theme: themeApi,
    logger: {
      // In web builds, swallow log messages; the app can add its own logging if desired.
      // We intentionally avoid using console here to keep logging centralized.
      log: () => Promise.resolve()
    },
    storage: storageApi,
    minimizeWindow: () => Promise.resolve(),
    maximizeWindow: () => Promise.resolve(),
    closeWindow: () => Promise.resolve(),
    toggleDeveloperTools: () => Promise.resolve(),
    setWindowTitle: () => Promise.resolve(),
    getWindowIcon: () => Promise.resolve(undefined),
    getCursorScreenPoint: () => Promise.resolve({ x: 0, y: 0 }),
    getActiveWindowBounds: () => Promise.resolve({
      x: 0,
      y: 0,
      width: window.innerWidth || 0,
      height: window.innerHeight || 0
    }),
    getCurrentWindowBounds: () => Promise.resolve({
      x: 0,
      y: 0,
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
      windowId: 0
    }),
    createAuxWindow: () => Promise.resolve(),
    getWindowUnderCursor: () => Promise.resolve(null),
    sendWorkbenchTabToWindow: () => Promise.resolve(false),
    onWorkbenchTabDropped: () => () => {
      // no-op
    }
  }

  w['api'] = api
}
