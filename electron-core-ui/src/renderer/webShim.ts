// Lightweight runtime shim to make electron-core-ui usable in pure web builds
// (without Electron preload defining window.api). In a real Electron renderer,
// the preload script will have already populated window.api, so this shim is
// effectively a no-op.

import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../types/theme'
import yaml from 'js-yaml'
import themeIndexJson from '../../resources/themes/index.json'
import baseYaml from '../../resources/themes/base.yaml?raw'
import darkBaseYaml from '../../resources/themes/dark/_base.yaml?raw'
import lightBaseYaml from '../../resources/themes/light/_base.yaml?raw'
import hcDarkBaseYaml from '../../resources/themes/hc_dark/_base.yaml?raw'
import hcLightBaseYaml from '../../resources/themes/hc_light/_base.yaml?raw'
import abyssYaml from '../../resources/themes/dark/abyss.yaml?raw'
import darkModernYaml from '../../resources/themes/dark/dark-modern.yaml?raw'
import darkPlusYaml from '../../resources/themes/dark/dark-plus.yaml?raw'
import kimbieDarkYaml from '../../resources/themes/dark/kimbie-dark.yaml?raw'
import monokaiYaml from '../../resources/themes/dark/monokai.yaml?raw'
import monokaiDimmedYaml from '../../resources/themes/dark/monokai-dimmed.yaml?raw'
import redYaml from '../../resources/themes/dark/red.yaml?raw'
import solarizedDarkYaml from '../../resources/themes/dark/solarized-dark.yaml?raw'
import tomorrowNightBlueYaml from '../../resources/themes/dark/tomorrow-night-blue.yaml?raw'
import lightModernYaml from '../../resources/themes/light/light-modern.yaml?raw'
import lightPlusYaml from '../../resources/themes/light/light-plus.yaml?raw'
import quietLightYaml from '../../resources/themes/light/quiet-light.yaml?raw'
import solarizedLightYaml from '../../resources/themes/light/solarized-light.yaml?raw'
import sunsetBeachDayYaml from '../../resources/themes/light/sunset-beach-day.yaml?raw'

interface WindowApiThemeShim {
  list: () => Promise<ThemeInfo[]>
  load: (themeId: string) => Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null>
  getCurrent: () => Promise<string | undefined>
  set: (themeId: string) => Promise<boolean>
  updateWCO: (colors: { backgroundColor: string; symbolColor: string }) => Promise<boolean>
  onThemeChanged: (callback: (themeId: string) => void) => () => void
}

interface WindowApiShim {
  platform: string
  theme: WindowApiThemeShim
  logger: {
    log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>
  }
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

type WindowWithOptionalApi = Window & { api?: WindowApiShim }

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

type ThemeCacheValue = { theme: ThemeDefinition; variables: ThemeVariables }

const themeIndex = themeIndexJson as ThemeIndex

const THEME_YAML_BY_ID: Record<string, string> = {
  'dark/abyss': abyssYaml,
  'dark/dark-modern': darkModernYaml,
  'dark/dark-plus': darkPlusYaml,
  'dark/kimbie-dark': kimbieDarkYaml,
  'dark/monokai': monokaiYaml,
  'dark/monokai-dimmed': monokaiDimmedYaml,
  'dark/red': redYaml,
  'dark/solarized-dark': solarizedDarkYaml,
  'dark/tomorrow-night-blue': tomorrowNightBlueYaml,
  'light/light-modern': lightModernYaml,
  'light/light-plus': lightPlusYaml,
  'light/quiet-light': quietLightYaml,
  'light/solarized-light': solarizedLightYaml,
  'light/sunset-beach-day': sunsetBeachDayYaml
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
    if (parsed?.variables) {
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
      if (parsed?.colors) {
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

async function webListThemes(): Promise<ThemeInfo[]> {
  ensureWebBaseLoaded()
  return themeIndex.themes.map((entry) => ({
    id: entry.id,
    name: entry.name,
    type: mapThemeTypeInternalToInfo(entry.type),
    path: entry.file
  }))
}

async function webLoadTheme(themeId: string): Promise<ThemeCacheValue | null> {
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

  const w = window as WindowWithOptionalApi

  // If preload already injected a real API (Electron), do nothing.
  if (w.api) {
    return
  }

  const themeApi: WindowApiThemeShim = {
    list: async () => webListThemes(),
    load: async (themeId: string) => webLoadTheme(themeId),
    getCurrent: async () => {
      // Default to first dark theme if available
      const themes = await webListThemes()
      const darkTheme = themes.find((t) => t.type === 'dark')
      return (darkTheme ?? themes[0])?.id
    },
    set: async () => true,
    updateWCO: async () => true,
    onThemeChanged: (_callback: (themeId: string) => void) => () => {
      // no-op in web shim
    }
  }

  const api: WindowApiShim = {
    platform: navigator.platform || 'web',
    theme: themeApi,
    logger: {
      // In web builds, swallow log messages; the app can add its own logging if desired.
      // We intentionally avoid using console here to keep logging centralized.
      log: async () => {}
    },
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    closeWindow: async () => {},
    toggleDeveloperTools: async () => {},
    setWindowTitle: async () => {},
    getWindowIcon: async () => undefined,
    getCursorScreenPoint: async () => ({ x: 0, y: 0 }),
    getActiveWindowBounds: async () => ({
      x: 0,
      y: 0,
      width: window.innerWidth || 0,
      height: window.innerHeight || 0
    }),
    getCurrentWindowBounds: async () => ({
      x: 0,
      y: 0,
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
      windowId: 0
    }),
    createAuxWindow: async () => {},
    getWindowUnderCursor: async () => null,
    sendWorkbenchTabToWindow: async () => false,
    onWorkbenchTabDropped: () => () => {
      // no-op
    }
  }

  w.api = api
}


